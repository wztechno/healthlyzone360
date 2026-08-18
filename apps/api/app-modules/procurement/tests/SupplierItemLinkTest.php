<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| Supplier↔item links — who sells this kitchen what
|--------------------------------------------------------------------------
|
| SUP2. One idempotent upsert and one idempotent delete over a *pair*, rather
| than two mirrored set-replaces — because a supplier's supplied items and an
| item's suppliers are one table read from two ends, and a replace at either end
| would silently undo the other's work.
|
| Four things are pinned here rather than trusted:
|
| - **the upsert is idempotent on the pair** — sending it twice leaves one row;
| - **preferred is a handover, not a claim** — promoting B demotes A inside one
|   transaction, and the partial unique index behind the rule never surfaces as
|   a 500;
| - **both ends are tenant-checked** — another kitchen's supplier and another
|   kitchen's shelf are each `404`, and nothing is written on the way there;
| - **no new permission** — links take the same `inventory.manage_organisation`
|   the supplier record itself takes, and a view-only holder is refused.
|
*/

/**
 * A kitchen whose user holds exactly $permissions.
 *
 * @param  list<string>  $permissions
 */
function linkWorld(string $email, array $permissions = PricingWorld::FULL_PERMISSIONS): object
{
    $tenant = PricingWorld::kitchen($email, $permissions);

    return (object) [
        'tenant' => $tenant,
        'organisation' => $tenant->organisation,
        'user' => $tenant->user,
        'organisationId' => (string) $tenant->organisation->getKey(),
        'headers' => PricingWorld::headers($tenant),
    ];
}

/** A supplier written straight into an organisation, without asserting the create. */
function linkSupplier(string $organisationId, string $code = 'SUP-1', string $name = 'Gulf Fresh'): Supplier
{
    return Supplier::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
    ]);
}

/**
 * A shelf, derived the way INV2.0 derives one — an ingredient behind it and a
 * real unit, so the row is the same shape a receipt would meet.
 */
function linkStockItem(string $organisationId, string $code = 'FLR-1', string $name = 'Flour'): StockItem
{
    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $organisationId,
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    return StockItem::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'code' => $code,
        'name_en' => $name,
        'unit_code' => 'kg',
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);
}

/** What a caller who may read the book but not write it holds. */
const LINK_VIEW_ONLY = [
    'organisation.view_current',
    'branch.view_current',
    'inventory.view_organisation',
];

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->world = linkWorld('links@kitchen.test');
    $this->actingAs($this->world->user);
    $this->headers = $this->world->headers;
});

it('creates a link once and updates it on the second call rather than doubling it', function (): void {
    $supplier = linkSupplier($this->world->organisationId);
    $item = linkStockItem($this->world->organisationId);

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier_link.supplier_id', (string) $supplier->getKey())
        ->assertJsonPath('data.supplier_link.stock_item_id', (string) $item->getKey())
        ->assertJsonPath('data.supplier_link.is_preferred', false)
        ->assertJsonPath('data.supplier_link.supplier_item_ref', null);

    // The same request again is the same row, edited — never a second one.
    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'supplier_item_ref' => 'GF-FLOUR-25',
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier_link.supplier_item_ref', 'GF-FLOUR-25');

    expect(SupplierStockItem::withoutTenancy()->where('supplier_id', $supplier->getKey())->count())->toBe(1);

    // Omitting the reference leaves it alone; sending null clears it.
    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => true,
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier_link.supplier_item_ref', 'GF-FLOUR-25')
        ->assertJsonPath('data.supplier_link.is_preferred', true);

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'supplier_item_ref' => null,
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier_link.supplier_item_ref', null)
        // Untouched by a write that did not mention it.
        ->assertJsonPath('data.supplier_link.is_preferred', true);
});

it('hands the preferred flag over without the partial unique index surfacing as a 500', function (): void {
    $organisationId = $this->world->organisationId;
    $first = linkSupplier($organisationId, 'GULF-01', 'Gulf Fresh');
    $second = linkSupplier($organisationId, 'BEKAA-01', 'Bekaa Farms');
    $item = linkStockItem($organisationId);

    foreach ([$first, $second] as $supplier) {
        $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
            'supplier_id' => (string) $supplier->getKey(),
            'stock_item_id' => (string) $item->getKey(),
        ], $this->headers)->assertOk();
    }

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $first->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => true,
    ], $this->headers)->assertOk();

    // The handover. Without the clear-before-set this is a 23505 mid-statement,
    // which would reach the client as a 500 that explains nothing.
    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $second->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => true,
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier_link.is_preferred', true);

    $preferred = SupplierStockItem::withoutTenancy()
        ->where('stock_item_id', $item->getKey())
        ->where('is_preferred', true)
        ->pluck('supplier_id');

    expect($preferred)->toHaveCount(1)
        ->and((string) $preferred->first())->toBe((string) $second->getKey());

    // Demoting promotes nobody: the system has no opinion about who takes over.
    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $second->getKey(),
        'stock_item_id' => (string) $item->getKey(),
        'is_preferred' => false,
    ], $this->headers)->assertOk();

    expect(SupplierStockItem::withoutTenancy()
        ->where('stock_item_id', $item->getKey())
        ->where('is_preferred', true)
        ->count())->toBe(0);
});

it('unlinks idempotently — a second delete is not an error', function (): void {
    $supplier = linkSupplier($this->world->organisationId);
    $item = linkStockItem($this->world->organisationId);

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
    ], $this->headers)->assertOk();

    $query = http_build_query([
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
    ]);

    $this->deleteJson("/api/v1/catalogue/procurement/supplier-links?{$query}", [], $this->headers)
        ->assertNoContent();

    // Already true is not an error.
    $this->deleteJson("/api/v1/catalogue/procurement/supplier-links?{$query}", [], $this->headers)
        ->assertNoContent();

    expect(SupplierStockItem::withoutTenancy()->where('supplier_id', $supplier->getKey())->count())->toBe(0);

    // The shelf is configuration that was removed, not history that was lost.
    expect(StockItem::withoutTenancy()->whereKey($item->getKey())->exists())->toBeTrue();
});

it('answers not-found for another organisation\'s supplier and for another organisation\'s stock item', function (): void {
    $other = linkWorld('other@kitchen.test');
    $foreignSupplier = linkSupplier($other->organisationId, 'FOREIGN-1', 'Elsewhere Trading');
    $foreignItem = linkStockItem($other->organisationId, 'FGN-1', 'Foreign Flour');

    $ownSupplier = linkSupplier($this->world->organisationId);
    $ownItem = linkStockItem($this->world->organisationId);

    // A supplier this kitchen does not own.
    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $foreignSupplier->getKey(),
        'stock_item_id' => (string) $ownItem->getKey(),
    ], $this->headers)->assertNotFound();

    // A shelf this kitchen does not own — the other direction, which a check
    // written only against the supplier would miss.
    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $ownSupplier->getKey(),
        'stock_item_id' => (string) $foreignItem->getKey(),
    ], $this->headers)->assertNotFound();

    $query = http_build_query([
        'supplier_id' => (string) $foreignSupplier->getKey(),
        'stock_item_id' => (string) $foreignItem->getKey(),
    ]);
    $this->deleteJson("/api/v1/catalogue/procurement/supplier-links?{$query}", [], $this->headers)
        ->assertNotFound();

    // And nothing was written on the way to any of those 404s.
    expect(SupplierStockItem::withoutTenancy()->count())->toBe(0);
});

it('serves supplied items on the detail and the count on the book', function (): void {
    $supplier = linkSupplier($this->world->organisationId);
    $flour = linkStockItem($this->world->organisationId, 'FLR-1', 'Flour');
    $sugar = linkStockItem($this->world->organisationId, 'SUG-1', 'Sugar');

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $sugar->getKey(),
        'supplier_item_ref' => 'GF-SUGAR-50',
    ], $this->headers)->assertOk();

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $flour->getKey(),
        'is_preferred' => true,
    ], $this->headers)->assertOk();

    $detail = $this->getJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}", $this->headers)
        ->assertOk();

    // Preferred first, then by item name — Sugar would sort after Flour anyway,
    // so the preferred flag is what this ordering is actually proving.
    expect($detail->json('data.supplier.supplied_items'))->toHaveCount(2);

    $detail
        ->assertJsonPath('data.supplier.supplied_items.0.stock_item.code', 'FLR-1')
        ->assertJsonPath('data.supplier.supplied_items.0.stock_item.backing', 'ingredient')
        ->assertJsonPath('data.supplier.supplied_items.0.stock_item.unit_code', 'kg')
        ->assertJsonPath('data.supplier.supplied_items.0.is_preferred', true)
        // Never bought here yet is a null last purchase, not a zero.
        ->assertJsonPath('data.supplier.supplied_items.0.last_purchase', null)
        ->assertJsonPath('data.supplier.supplied_items.1.supplier_item_ref', 'GF-SUGAR-50')
        ->assertJsonPath('data.supplier.supplied_item_count', 2);

    $this->getJson('/api/v1/catalogue/procurement/suppliers', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.suppliers.0.supplied_item_count', 2);
});

it('lets a view-only holder read the links and forbids every write', function (): void {
    $viewer = linkWorld('viewer@kitchen.test', LINK_VIEW_ONLY);
    $supplier = linkSupplier($viewer->organisationId);
    $item = linkStockItem($viewer->organisationId);

    $this->actingAs($viewer->user);

    $this->getJson("/api/v1/catalogue/procurement/suppliers/{$supplier->getKey()}", $viewer->headers)
        ->assertOk()
        ->assertJsonPath('data.supplier.supplied_items', []);

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
    ], $viewer->headers)->assertForbidden();

    $query = http_build_query([
        'supplier_id' => (string) $supplier->getKey(),
        'stock_item_id' => (string) $item->getKey(),
    ]);
    $this->deleteJson("/api/v1/catalogue/procurement/supplier-links?{$query}", [], $viewer->headers)
        ->assertForbidden();

    expect(SupplierStockItem::withoutTenancy()->count())->toBe(0);
});

it('refuses a malformed pair before it reaches the service', function (): void {
    $supplier = linkSupplier($this->world->organisationId);

    $this->putJson('/api/v1/catalogue/procurement/supplier-links', [
        'supplier_id' => (string) $supplier->getKey(),
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    $this->deleteJson('/api/v1/catalogue/procurement/supplier-links', [], $this->headers)
        ->assertStatus(422);
});
