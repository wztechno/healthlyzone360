<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\DietClassification;

/*
|--------------------------------------------------------------------------
| What an item is made of and where it is sold
|--------------------------------------------------------------------------
|
| Variants, packs, ingredients, diet tags and channel availability — five
| set-replace endpoints that share one rule: the body is the complete
| statement, and the item's lock_version is the validator.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('composer@catalogue.test');
    $this->b = CatalogueWorld::kitchen('other@catalogue.test');
});

it('replaces packs by code, keeping identifiers and archiving what is absent', function (): void {
    // Matching on code means a submitted set keeps the identifiers a price
    // will point at; absent codes are archived rather than deleted, because
    // the catalogue never loses a row an order might reference.
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/items/'.$item->getKey().'/variants';

    $first = $this->putJson($url, [
        'variants' => [
            ['code' => 'jar-250g', 'name_en' => '250 g jar', 'pack' => ['pack_quantity' => 0.25, 'pack_unit_id' => CatalogueWorld::unit('kg')]],
            ['code' => 'tub-1kg', 'name_en' => '1 kg tub', 'is_default' => true, 'pack' => ['pack_quantity' => 1, 'pack_unit_id' => CatalogueWorld::unit('kg'), 'pack_format' => 'bag']],
        ],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    $jarId = collect($first->json('data.variants'))->firstWhere('code', 'jar-250g')['id'];

    expect(collect($first->json('data.variants'))->firstWhere('code', 'tub-1kg')['is_default'])->toBeTrue()
        ->and(collect($first->json('data.variants'))->firstWhere('code', 'jar-250g')['is_default'])->toBeFalse()
        // Derived from the item type, never accepted from a client.
        ->and($first->json('data.variants.0.variant_type'))->toBe('pack');

    $second = $this->putJson($url, [
        'variants' => [
            ['code' => 'jar-250g', 'name_en' => '250 g jar', 'is_default' => true, 'pack' => ['pack_quantity' => 0.25, 'pack_unit_id' => CatalogueWorld::unit('kg')]],
        ],
    ], $headers + ['If-Match' => '"1"'])->assertOk();

    $jar = collect($second->json('data.variants'))->firstWhere('code', 'jar-250g');
    $tub = collect($second->json('data.variants'))->firstWhere('code', 'tub-1kg');

    expect($jar['id'])->toBe($jarId)
        ->and($jar['is_default'])->toBeTrue()
        ->and($tub['status'])->toBe('archived')
        // Cleared with the archival, so the partial unique index does not
        // refuse the incoming default.
        ->and($tub['is_default'])->toBeFalse();

    expect(AuditLog::query()->where('action', 'catalogue.item_variants_replaced')->count())->toBe(2);
});

it('gives one item exactly one default variant, at the database level', function (): void {
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/items/'.$item->getKey().'/variants';

    // Two defaults is a stated contradiction and is refused.
    $this->putJson($url, [
        'variants' => [
            ['code' => 'a', 'is_default' => true, 'pack' => ['pack_quantity' => 1, 'pack_unit_id' => CatalogueWorld::unit('kg')]],
            ['code' => 'b', 'is_default' => true, 'pack' => ['pack_quantity' => 2, 'pack_unit_id' => CatalogueWorld::unit('kg')]],
        ],
    ], $headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // None is not: the first submitted wins, deterministically.
    $this->putJson($url, [
        'variants' => [
            ['code' => 'a', 'pack' => ['pack_quantity' => 1, 'pack_unit_id' => CatalogueWorld::unit('kg')]],
            ['code' => 'b', 'pack' => ['pack_quantity' => 2, 'pack_unit_id' => CatalogueWorld::unit('kg')]],
        ],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    expect(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $item->getKey())->where('is_default', true)->count())
        ->toBe(1)
        ->and(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $item->getKey())->where('is_default', true)->value('code'))
        ->toBe('a');
});

it('refuses variants on a meal and a pack on a plan configuration', function (): void {
    $meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $plan = CatalogueItem::factory()->subscriptionPlan()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];

    // A meal is sold as itself.
    $this->putJson('/api/v1/catalogue/items/'.$meal->getKey().'/variants', [
        'variants' => [['code' => 'anything']],
    ], $headers)->assertStatus(422);

    // A plan configuration is not sold in a pack, and a pack with no size is
    // not a pack.
    $this->putJson('/api/v1/catalogue/items/'.$plan->getKey().'/variants', [
        'variants' => [['code' => 'standard-5', 'pack' => ['pack_quantity' => 1, 'pack_unit_id' => CatalogueWorld::unit('kg')]]],
    ], $headers)->assertStatus(422);

    $this->putJson('/api/v1/catalogue/items/'.$plan->getKey().'/variants', [
        'variants' => [['code' => 'standard-5', 'name_en' => 'Standard, 5 days']],
    ], $headers)
        ->assertOk()
        ->assertJsonPath('data.variants.0.variant_type', 'plan_configuration')
        ->assertJsonPath('data.variants.0.pack', null);

    expect(CatalogueItemPackVariant::withoutTenancy()->count())->toBe(0);
});

it('replaces the public ingredient list in the order it was given', function (): void {
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $chickpeas = CatalogueWorld::mappedIngredient($this->a->organisation, 'Chickpeas', 'gluten');
    $tahini = CatalogueWorld::mappedIngredient($this->a->organisation, 'Tahini', 'sesame');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $this->putJson('/api/v1/catalogue/items/'.$item->getKey().'/ingredients', [
        'ingredients' => [
            ['ingredient_id' => (string) $chickpeas->getKey(), 'is_representative' => true],
            ['ingredient_id' => (string) $tahini->getKey()],
        ],
    ], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.ingredients.0.ingredient_id', (string) $chickpeas->getKey())
        ->assertJsonPath('data.ingredients.0.display_order', 1)
        ->assertJsonPath('data.ingredients.0.is_representative', true)
        ->assertJsonPath('data.ingredients.1.display_order', 2);

    // An ingredient may be listed once.
    $this->putJson('/api/v1/catalogue/items/'.$item->getKey().'/ingredients', [
        'ingredients' => [
            ['ingredient_id' => (string) $tahini->getKey()],
            ['ingredient_id' => (string) $tahini->getKey()],
        ],
    ], $headers + ['If-Match' => '"1"'])->assertStatus(422);
});

it('replaces diet tags by code and refuses one the platform does not know', function (): void {
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/items/'.$item->getKey().'/diet-classifications';

    $this->putJson($url, ['diet_classifications' => ['vegan', 'gluten_free']], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.diet_classifications', ['vegan', 'gluten_free']);

    // A kitchen that could invent "keto-ish" would make the customer-side
    // filter meaningless the first time two kitchens spelt one idea
    // differently.
    $this->putJson($url, ['diet_classifications' => ['keto-ish']], $headers + ['If-Match' => '"1"'])
        ->assertStatus(422)
        ->assertJsonPath('error.details.unknown', ['keto-ish']);

    // A deactivated classification is withdrawn, not merely hidden.
    DietClassification::query()->where('code', 'vegan')->update(['is_active' => false]);

    $this->putJson($url, ['diet_classifications' => ['vegan']], $headers + ['If-Match' => '"1"'])
        ->assertStatus(422);
});

it('replaces channel availability as one statement', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    $web = SalesChannel::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'web-shop']);
    $wholesale = SalesChannel::factory()->wholesale()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'wholesale']);

    $variantId = (string) CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $item->getKey())->sole()->getKey();

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/items/'.$item->getKey().'/channels';

    $this->putJson($url, [
        'channels' => [
            ['sales_channel_id' => (string) $web->getKey(), 'is_available' => true],
            ['sales_channel_id' => (string) $wholesale->getKey(), 'catalogue_item_variant_id' => $variantId, 'available_from' => '2026-03-01'],
        ],
    ], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonCount(2, 'data.channels');

    expect(ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $item->getKey())->count())->toBe(2);

    // An empty array withdraws the item from every channel, which is a
    // decision a kitchen makes rather than a field it forgot.
    $this->putJson($url, ['channels' => []], $headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.channels', []);

    expect(ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', $item->getKey())->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'catalogue.item_channels_updated')->count())->toBe(2);
});

it('refuses an availability window that ends before it begins, and a channel stated twice', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);
    $web = SalesChannel::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'web-shop']);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];
    $url = '/api/v1/catalogue/items/'.$item->getKey().'/channels';

    $this->putJson($url, [
        'channels' => [['sales_channel_id' => (string) $web->getKey(), 'available_from' => '2026-06-01', 'available_to' => '2026-03-01']],
    ], $headers)->assertStatus(422);

    $this->putJson($url, [
        'channels' => [
            ['sales_channel_id' => (string) $web->getKey()],
            ['sales_channel_id' => (string) $web->getKey()],
        ],
    ], $headers)->assertStatus(422);
});

it('refuses another organisations channel and another items variant', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);
    $theirChannel = SalesChannel::factory()->create(['organisation_id' => $this->b->organisation->getKey(), 'code' => 'their-shop']);
    $theirItem = CatalogueWorld::publishableProduct($this->b, 'Their dip');
    $theirVariantId = (string) CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $theirItem->getKey())->sole()->getKey();

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];
    $url = '/api/v1/catalogue/items/'.$item->getKey().'/channels';

    $this->putJson($url, [
        'channels' => [['sales_channel_id' => (string) $theirChannel->getKey()]],
    ], $headers)->assertStatus(422);

    $mine = SalesChannel::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'code' => 'mine']);

    $this->putJson($url, [
        'channels' => [['sales_channel_id' => (string) $mine->getKey(), 'catalogue_item_variant_id' => $theirVariantId]],
    ], $headers)->assertStatus(422);

    expect(ChannelCatalogueItem::withoutTenancy()->count())->toBe(0);
});

it('creates and updates a sales channel but never lets its code or kind move', function (): void {
    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $created = $this->postJson('/api/v1/catalogue/sales-channels', [
        'code' => 'wholesale',
        'channel_kind' => 'b2b',
        'name_en' => 'Wholesale desk',
        'name_ar' => 'قسم الجملة',
        'order_source' => 'phone',
    ], $headers)
        ->assertCreated()
        ->assertJsonPath('data.sales_channel.status', 'active')
        ->assertHeader('ETag', '"0"');

    $id = $created->json('data.sales_channel.id');

    // A duplicate code is a conflict, not a second channel.
    $this->postJson('/api/v1/catalogue/sales-channels', [
        'code' => 'wholesale',
        'channel_kind' => 'b2b',
        'name_en' => 'Another desk',
    ], $headers)->assertStatus(409);

    // Neither the code nor the kind is in the update rules; sending them is
    // simply ignored, and the row is unchanged.
    $this->patchJson('/api/v1/catalogue/sales-channels/'.$id, [
        'name_en' => 'Wholesale',
        'status' => 'inactive',
        'code' => 'retail',
        'channel_kind' => 'b2c_web',
    ], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.sales_channel.status', 'inactive')
        ->assertJsonPath('data.sales_channel.code', 'wholesale')
        ->assertJsonPath('data.sales_channel.channel_kind', 'b2b');

    // Addressable by code as well as by identifier.
    $this->getJson('/api/v1/catalogue/sales-channels/wholesale', $headers)
        ->assertOk()
        ->assertJsonPath('data.sales_channel.id', $id);

    expect(AuditLog::query()->where('action', 'catalogue.sales_channel_created')->count())->toBe(1)
        ->and(AuditLog::query()->where('action', 'catalogue.sales_channel_updated')->count())->toBe(1);
});

it('keeps one kitchens sales channels invisible to the other', function (): void {
    SalesChannel::factory()->create(['organisation_id' => $this->b->organisation->getKey(), 'code' => 'their-shop']);

    $this->actingAs($this->a->user);

    $listed = $this->getJson('/api/v1/catalogue/sales-channels', CatalogueWorld::headers($this->a))->assertOk()->json('data');

    expect($listed)->toBe([]);

    $this->getJson('/api/v1/catalogue/sales-channels/their-shop', CatalogueWorld::headers($this->a))
        ->assertNotFound();
});
