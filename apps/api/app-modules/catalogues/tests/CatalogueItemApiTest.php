<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
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
