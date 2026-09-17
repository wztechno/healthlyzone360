<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Catalogue items over HTTP — identity, isolation and concurrency
|--------------------------------------------------------------------------
|
| Two kitchens exist in every test. What has to hold: a kitchen sees its own
| items and nobody else's; a slug is fixed for life; every write is
| optimistically locked; every mutation is audited; and the pagination
| survives being walked while rows exist beyond one page.
|
| Publication gates, retirement and derived allergens are
| CatalogueItemLifecycleTest. Variants and channels are
| CatalogueItemCompositionTest.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('manager-a@catalogue.test');
    $this->b = CatalogueWorld::kitchen('manager-b@catalogue.test');
});

it('creates a draft item and derives its slug', function (): void {
    $this->actingAs($this->a->user);

    $response = $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'product',
        'name_en' => 'Harissa Paste 250g',
        'name_ar' => 'معجون الهريسة',
        'catalogue_id' => (string) $this->a->catalogue->getKey(),
    ], CatalogueWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.item.slug', 'harissa-paste-250g')
        // Nothing is ever created published: publication is a separate action
        // with a separate permission behind a readiness gate.
        ->assertJsonPath('data.item.status', 'draft')
        ->assertJsonPath('data.item.item_type', 'product')
        ->assertJsonPath('data.item.lock_version', 0)
        ->assertHeader('ETag', '"0"');

    expect(CatalogueItem::withoutTenancy()->whereKey($response->json('data.item.id'))->value('organisation_id'))
        ->toBe((string) $this->a->organisation->getKey())
        ->and(AuditLog::query()->where('action', 'catalogue.item_created')->count())->toBe(1);
});

it('records an untranslated Arabic name as empty rather than as the English one', function (): void {
    // Unlike a recipe, where the Arabic name falls back to the English one so
    // drafting stays frictionless. A catalogue item is customer-facing, so an
    // untranslated name must be visible *as* untranslated — and the publish
    // gate is what makes that consequential.
    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Freekeh Bowl',
    ], CatalogueWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.item.name_en', 'Freekeh Bowl')
        ->assertJsonPath('data.item.name_ar', '');
});

it('sells one yield piece per portion unless the kitchen says otherwise', function (): void {
    // The default is the arithmetic every reader had before the column existed:
    // one piece is one sold unit. It is NOT NULL precisely so that no reader has
    // to keep its own copy of that rule.
    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Lasagne Tray Square',
    ], CatalogueWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.item.portion_factor', '1.000');
});

it('records a half portion of the same recipe and refuses one that is not a portion at all', function (): void {
    // One number scales both the diner's per-serving nutrition and the stock the
    // sale consumes, so the half square is a factor rather than a second recipe.
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];
    $url = '/api/v1/catalogue/items/'.$item->getKey();

    $this->patchJson($url, ['portion_factor' => 0.5], $headers)
        ->assertOk()
        ->assertJsonPath('data.item.portion_factor', '0.500');

    $next = CatalogueWorld::headers($this->a) + ['If-Match' => '"1"'];

    // Zero is a sale that eats nothing and feeds nobody, and a negative is not a
    // portion. Refused by name here rather than by a 500 from the CHECK.
    $this->patchJson($url, ['portion_factor' => 0], $next)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.fields.portion_factor.0', fn (?string $message): bool => $message !== null);

    // Below the column's own three places: 0.0004 would round to 0.000 and trip
    // the CHECK as a 500, so the request rules stop it one layer earlier.
    $this->patchJson($url, ['portion_factor' => 0.0004], $next)
        ->assertStatus(422)
        ->assertJsonPath('error.details.fields.portion_factor.0', fn (?string $message): bool => $message !== null);

    // Not nullable, and not silently ignored either: a client that sent null
    // believed it was writing something, and "unknown portion" is one piece.
    $this->patchJson($url, ['portion_factor' => null], $next)
        ->assertStatus(422)
        ->assertJsonPath('error.details.fields.portion_factor.0', fn (?string $message): bool => $message !== null);

    expect(CatalogueItem::withoutTenancy()->whereKey($item->getKey())->value('portion_factor'))->toBe('0.500');
});

it('creates a default catalogue on demand when the caller names none', function (): void {
    // A kitchen with one range should not have to know the concept exists to
    // add a product to it.
    $tenant = CatalogueWorld::kitchen('manager-c@catalogue.test');
    $tenant->catalogue->delete();

    $this->actingAs($tenant->user);

    $id = $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'product',
        'name_en' => 'Olive Oil',
    ], CatalogueWorld::headers($tenant))->assertCreated()->json('data.item.catalogue_id');

    expect($id)->not->toBeNull();
});

it('renames an item without moving its slug', function (): void {
    // A slug is what a link, a marketplace listing and a partner integration
    // hold. A system that lets it move quietly breaks other peoples bookmarks
    // on a typo fix.
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];

    $this->patchJson('/api/v1/catalogue/items/'.$item->getKey(), [
        'name_en' => 'Harissa paste (hot)',
    ], $headers)
        ->assertOk()
        ->assertJsonPath('data.item.name_en', 'Harissa paste (hot)')
        ->assertJsonPath('data.item.slug', $item->slug)
        ->assertJsonPath('data.item.lock_version', 1);
});

it('refuses a request that tries to change the slug or the item type', function (): void {
    // Refused rather than stripped: silently dropping a field a client
    // believed it was writing is how a caller learns nothing.
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];

    $this->patchJson('/api/v1/catalogue/items/'.$item->getKey(), ['slug' => 'something-else'], $headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.fields.slug.0', 'A slug is fixed when the item is created. Rename the item instead.');

    $this->patchJson('/api/v1/catalogue/items/'.$item->getKey(), ['item_type' => 'meal'], $headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(CatalogueItem::withoutTenancy()->whereKey($item->getKey())->value('slug'))->toBe($item->slug);
});

it('keeps one kitchens catalogue invisible and unreachable to the other', function (): void {
    $theirs = CatalogueWorld::publishableProduct($this->b, 'Their Signature Dip');

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $listed = collect($this->getJson('/api/v1/catalogue/items?limit=100', $headers)->assertOk()->json('data'))
        ->pluck('id')
        ->all();

    expect($listed)->not->toContain((string) $theirs->getKey());

    // Not merely hidden from the list: unreachable by identifier, and
    // indistinguishable from an item that never existed.
    $this->getJson('/api/v1/catalogue/items/'.$theirs->getKey(), $headers)
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');

    $this->patchJson('/api/v1/catalogue/items/'.$theirs->getKey(), ['name_en' => 'Mine now'], $headers + ['If-Match' => '"0"'])
        ->assertNotFound();

    $this->putJson('/api/v1/catalogue/items/'.$theirs->getKey().'/variants', ['variants' => []], $headers + ['If-Match' => '"0"'])
        ->assertNotFound();

    expect(CatalogueItem::withoutTenancy()->whereKey($theirs->getKey())->value('lock_version'))->toBe(0);
});

it('resolves an item by slug as well as by identifier', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/items/'.$item->slug, CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('data.item.id', (string) $item->getKey());
});

it('demands a precondition, refuses a stale one and accepts the current one', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/items/'.$item->getKey();

    $this->patchJson($url, ['name_en' => 'Renamed'], $headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required')
        ->assertJsonPath('error.details.required_headers', ['If-Match']);

    $this->patchJson($url, ['name_en' => 'Renamed'], $headers + ['If-Match' => '"7"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.current_lock_version', 0);

    $this->patchJson($url, ['name_en' => 'Renamed'], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertHeader('ETag', '"1"');

    // The validator the caller just used is now spent.
    $this->patchJson($url, ['name_en' => 'Again'], $headers + ['If-Match' => '"0"'])
        ->assertStatus(409);
});

it('filters by type, status and category and walks the cursor', function (): void {
    CatalogueItem::factory()->count(3)->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $category = ProductCategory::factory()->create(['code' => 'sauce-test']);

    CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'product_category_id' => $category->getKey(),
    ]);

    CatalogueItem::factory()->retired()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    // Retired rows are excluded unless asked for by name: a list that offered
    // withdrawn articles by default invites somebody to price one.
    $all = $this->getJson('/api/v1/catalogue/items?limit=100', $headers)->assertOk()->json('data');
    expect($all)->toHaveCount(4);

    $retired = $this->getJson('/api/v1/catalogue/items?status=retired&limit=100', $headers)->assertOk()->json('data');
    expect($retired)->toHaveCount(1);

    $meals = $this->getJson('/api/v1/catalogue/items?item_type=meal&limit=100', $headers)->assertOk()->json('data');
    expect($meals)->toHaveCount(1);

    $byCategory = $this->getJson('/api/v1/catalogue/items?product_category_id='.$category->getKey().'&limit=100', $headers)
        ->assertOk()->json('data');
    expect($byCategory)->toHaveCount(1);

    $this->getJson('/api/v1/catalogue/items?item_type=nonsense', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');

    // A keyset walk visits every row exactly once.
    $first = $this->getJson('/api/v1/catalogue/items?limit=2', $headers)->assertOk();
    expect($first->json('meta.has_more'))->toBeTrue();

    $second = $this->getJson('/api/v1/catalogue/items?limit=2&cursor='.$first->json('meta.next_cursor'), $headers)->assertOk();

    $seen = array_merge(
        array_column($first->json('data'), 'id'),
        array_column($second->json('data'), 'id'),
    );

    expect($seen)->toHaveCount(4)->and(array_unique($seen))->toHaveCount(4);
});

it('never writes an audit metadata key the redactor would blank', function (): void {
    $item = CatalogueWorld::publishableProduct($this->a);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $this->patchJson('/api/v1/catalogue/items/'.$item->getKey(), ['name_en' => 'Renamed'], $headers + ['If-Match' => '"0"'])
        ->assertOk();

    $this->postJson('/api/v1/catalogue/sales-channels', [
        'code' => 'web-shop',
        'channel_kind' => 'b2c_web',
        'name_en' => 'Web shop',
    ], $headers)->assertCreated();

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], $headers + ['If-Match' => '"1"'])
        ->assertOk();

    $events = AuditLog::query()->where('action', 'like', 'catalogue.item%')
        ->orWhere('action', 'like', 'catalogue.sales_channel%')
        ->get();

    expect($events)->not->toBeEmpty();

    foreach ($events as $event) {
        foreach (array_keys((array) $event->metadata) as $key) {
            // The redactor matches `code` as a substring, so any key
            // containing it would be persisted as "[redacted]" (OQ-036).
            expect(str_contains(strtolower((string) $key), 'code'))
                ->toBeFalse("Audit metadata key [{$key}] would be redacted by the substring match.");
        }

        expect($event->metadata)->not->toContain('[redacted]');
    }
});

it('withholds publication from a caller who may edit but not publish', function (): void {
    // A merchandiser writes the listing; deciding the range is somebody else.
    $editor = CatalogueWorld::kitchen('editor@catalogue.test', [
        'catalogue.view_organisation',
        'catalogue.manage_organisation',
    ]);

    $item = CatalogueWorld::publishableProduct($editor);

    $this->actingAs($editor->user);
    $headers = CatalogueWorld::headers($editor);

    $this->postJson('/api/v1/catalogue/items/'.$item->getKey().'/publish', [], $headers + ['If-Match' => '"0"'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied');

    // And editing still works, so the refusal is about the authority and not
    // about the caller being locked out entirely.
    $this->patchJson('/api/v1/catalogue/items/'.$item->getKey(), ['name_en' => 'Edited'], $headers + ['If-Match' => '"0"'])
        ->assertOk();
});

it('refuses every write to a retired item', function (): void {
    $item = CatalogueItem::factory()->retired()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'];

    $this->patchJson('/api/v1/catalogue/items/'.$item->getKey(), ['name_en' => 'Back from the dead'], $headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $this->putJson('/api/v1/catalogue/items/'.$item->getKey().'/variants', ['variants' => []], $headers)
        ->assertStatus(409);

    expect(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $item->getKey())->count())->toBe(0);
});

it('serves numbered pages that count the type asked for, not the catalogue', function (): void {
    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $owner = [
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ];

    // One endpoint, three screens: meals, products and plans are separated by
    // `item_type` rather than by path, so a page control on any one of them is
    // wrong unless the count is taken after the type filter.
    CatalogueItem::factory()->count(7)->create($owner);
    CatalogueItem::factory()->meal()->count(3)->create($owner);
    CatalogueItem::factory()->subscriptionPlan()->count(2)->create($owner);

    $this->getJson('/api/v1/catalogue/items?item_type=meal&page=1&per_page=2', $headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.total_count', 3)
        ->assertJsonPath('meta.total_pages', 2);

    $this->getJson('/api/v1/catalogue/items?item_type=product&page=1&per_page=2', $headers)
        ->assertOk()
        ->assertJsonPath('meta.total_count', 7)
        ->assertJsonPath('meta.total_pages', 4);

    $this->getJson('/api/v1/catalogue/items?item_type=subscription_plan&page=1&per_page=2', $headers)
        ->assertOk()
        ->assertJsonPath('meta.total_count', 2)
        ->assertJsonPath('meta.total_pages', 1);

    // Page 2 of the meals is the third meal and nothing else — not the eighth
    // row of the catalogue.
    $this->getJson('/api/v1/catalogue/items?item_type=meal&page=2&per_page=2', $headers)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.item_type', 'meal');

    $this->getJson('/api/v1/catalogue/items?item_type=meal&page=3&per_page=2', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.details.parameter', 'page');
});

/*
|--------------------------------------------------------------------------
| Selling from finished stock (PROD1)
|--------------------------------------------------------------------------
|
| A meal is cooked when it is ordered, and a sale of one explodes its recipe
| onto the raw-material shelves. A meal *made in advance* is not: the raw
| materials left the shelves when the batch was cooked, so the sale has to draw
| the finished item's own shelf or take them twice.
|
| `sells_from_finished_stock` is the opt-in, and these are the rules around it.
| Its two preconditions — a kitchen that produces the meal, an ingredient a
| published recipe version outputs — are refused on the write rather than
| discovered by a customer's order days later. So is the one state that would
| otherwise break silently: flag on, shelf counted in kilograms, nothing saying
| how much one sold unit is.
|
*/

it('records a meal that sells from finished stock, with what one sold unit is', function (): void {
    $ingredient = CatalogueWorld::producedIngredient($this->a);

    $this->actingAs($this->a->user);

    $response = $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Prepared Caesar Salad 300g',
        'production_mode' => 'production',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
        'net_content_quantity' => 0.3,
        'net_content_unit_id' => CatalogueWorld::unit('kg'),
    ], CatalogueWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.item.sells_from_finished_stock', true)
        // A string on the wire, at the column's own four places, for the reason
        // every decimal on this surface is one: a float would have rounded it.
        ->assertJsonPath('data.item.net_content_quantity', '0.3000')
        ->assertJsonPath('data.item.net_content_unit_id', CatalogueWorld::unit('kg'));

    // And it survives a read, rather than being echoed once by the create.
    $this->getJson('/api/v1/catalogue/items/'.$response->json('data.item.id'), CatalogueWorld::headers($this->a))
        ->assertOk()
        ->assertJsonPath('data.item.net_content_quantity', '0.3000')
        ->assertJsonPath('data.item.sells_from_finished_stock', true);
});

it('defaults a meal to exploding its recipe', function (): void {
    // The column is NOT NULL DEFAULT false precisely so that every meal already
    // in a catalogue keeps deducting exactly what it deducted before the column
    // existed. A meal becomes a finished-stock meal by being said to be one.
    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Freekeh Bowl',
    ], CatalogueWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.item.sells_from_finished_stock', false)
        ->assertJsonPath('data.item.net_content_quantity', null)
        ->assertJsonPath('data.item.net_content_unit_id', null);
});

it('refuses finished-stock selling on a meal this kitchen does not produce', function (): void {
    $ingredient = CatalogueWorld::producedIngredient($this->a);

    $this->actingAs($this->a->user);

    // Every precondition but the mode. A kitchen cannot sell a shelf of
    // something it does not make — the shelf would never be filled.
    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Bought-in Salad',
        'production_mode' => 'supplier',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
    ], CatalogueWorld::headers($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath(
            'error.details.fields.sells_from_finished_stock.0',
            fn (?string $message): bool => $message !== null && str_contains($message, 'production mode'),
        );

    expect(CatalogueItem::withoutTenancy()->where('name_en', 'Bought-in Salad')->exists())->toBeFalse();
});

it('refuses finished-stock selling against an ingredient no published recipe produces', function (): void {
    $draftOnly = CatalogueWorld::producedIngredient(
        $this->a,
        'Unpublished salad',
        'kg',
        RecipeVersionStatus::Draft,
    );

    $this->actingAs($this->a->user);

    // A draft version is a plan. Nothing has been made from it, so there is no
    // shelf — which is the same reason the publish gate re-asks the question.
    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Salad From Nowhere',
        'production_mode' => 'production',
        'ingredient_id' => (string) $draftOnly->getKey(),
        'sells_from_finished_stock' => true,
        'net_content_quantity' => 0.3,
        'net_content_unit_id' => CatalogueWorld::unit('kg'),
    ], CatalogueWorld::headers($this->a))
        ->assertStatus(422)
        ->assertJsonPath(
            'error.details.fields.sells_from_finished_stock.0',
            fn (?string $message): bool => $message !== null && str_contains($message, 'published recipe'),
        );

    expect(CatalogueItem::withoutTenancy()->where('name_en', 'Salad From Nowhere')->exists())->toBeFalse();
});

it('refuses a net content measured in a unit that does not exist', function (): void {
    $ingredient = CatalogueWorld::producedIngredient($this->a);

    $this->actingAs($this->a->user);

    // Without this check the foreign key is the only backstop, and a mistyped
    // identifier is a 500 rather than a 422 naming the field somebody got wrong.
    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Salad In Nothing',
        'production_mode' => 'production',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
        'net_content_quantity' => 0.3,
        'net_content_unit_id' => '00000000-0000-4000-8000-000000000000',
    ], CatalogueWorld::headers($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.details.fields.net_content_unit_id.0', fn (?string $m): bool => $m !== null);

    expect(CatalogueItem::withoutTenancy()->where('name_en', 'Salad In Nothing')->exists())->toBeFalse();
});

it('refuses a finished-stock meal on a weighed shelf that says nothing about one sold unit', function (): void {
    $ingredient = CatalogueWorld::producedIngredient($this->a);

    $this->actingAs($this->a->user);

    // The trap this rule closes. The shelf counts in kilograms, so "one sold
    // unit" is a conversion nothing else in the record can express — and
    // `OrderConsumptionService` refuses such a sale with `no_net_content`
    // rather than guessing. The write refuses exactly what the sale would,
    // days earlier and in front of the person who can fix it.
    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Salad Of Unknown Size',
        'production_mode' => 'production',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
    ], CatalogueWorld::headers($this->a))
        ->assertStatus(422)
        ->assertJsonPath(
            'error.details.fields.net_content_quantity.0',
            fn (?string $m): bool => $m !== null && str_contains($m, 'finished stock'),
        );

    expect(CatalogueItem::withoutTenancy()->where('name_en', 'Salad Of Unknown Size')->exists())->toBeFalse();
});

it('asks nothing about net content when the shelf is counted in pieces', function (): void {
    // `portion_factor` already means something on a counted shelf — one sold
    // unit is one piece — so demanding a net content there would be asking for
    // a second answer to a settled question.
    $ingredient = CatalogueWorld::producedIngredient($this->a, 'Frozen lasagne', 'piece');

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Frozen Lasagne Portion',
        'production_mode' => 'production',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
    ], CatalogueWorld::headers($this->a))
        ->assertCreated()
        ->assertJsonPath('data.item.sells_from_finished_stock', true)
        ->assertJsonPath('data.item.net_content_quantity', null);
});

it('refuses a net content that is not a positive quantity', function (): void {
    $ingredient = CatalogueWorld::producedIngredient($this->a);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/items', [
        'item_type' => 'meal',
        'name_en' => 'Salad Of No Size',
        'production_mode' => 'production',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
        'net_content_quantity' => 0,
        'net_content_unit_id' => CatalogueWorld::unit('kg'),
    ], CatalogueWorld::headers($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.details.fields.net_content_quantity.0', fn (?string $m): bool => $m !== null);
});

it('turns finished-stock selling on and off again over the update endpoint', function (): void {
    $ingredient = CatalogueWorld::producedIngredient($this->a);
    $item = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Caesar salad',
    ]);

    $this->actingAs($this->a->user);
    $url = '/api/v1/catalogue/items/'.$item->getKey();

    // The whole chain in one PATCH, which is what the meal editor sends.
    $this->patchJson($url, [
        'production_mode' => 'production',
        'ingredient_id' => (string) $ingredient->getKey(),
        'sells_from_finished_stock' => true,
        'net_content_quantity' => 0.3,
        'net_content_unit_id' => CatalogueWorld::unit('kg'),
    ], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.item.sells_from_finished_stock', true)
        ->assertJsonPath('data.item.net_content_quantity', '0.3000');

    // And off again. Switching off must also drop the net content, or a meal
    // could carry a conversion for a shelf it no longer sells from — and the
    // weighed-shelf rule has nothing left to refuse once the flag is false.
    $this->patchJson($url, [
        'sells_from_finished_stock' => false,
        'net_content_quantity' => null,
        'net_content_unit_id' => null,
    ], CatalogueWorld::headers($this->a) + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.item.sells_from_finished_stock', false)
        ->assertJsonPath('data.item.net_content_quantity', null);

    $stored = CatalogueItem::withoutTenancy()->whereKey($item->getKey())->sole();

    expect($stored->sells_from_finished_stock)->toBeFalse()
        ->and($stored->net_content_unit_id)->toBeNull()
        // The link and the mode survive the flag being cleared: a kitchen that
        // stops selling a salad off the shelf still produces it.
        ->and($stored->ingredient_id)->toBe((string) $ingredient->getKey());
});
