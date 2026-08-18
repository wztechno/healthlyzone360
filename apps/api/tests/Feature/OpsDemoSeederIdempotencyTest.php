<?php

declare(strict_types=1);

use App\Models\User;
use Database\Seeders\OpsDemoSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\IngredientCostService;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| OpsDemoSeeder — the reseed guarantee (SUP8)
|--------------------------------------------------------------------------
|
| §8: "Reseeding does not change quantities/costs." The demonstration kitchen is
| not a fixture that gets thrown away; it is the world a demonstrator receives
| deliveries into, wastes stock from and retunes thresholds on, and the next
| `db:seed` — which happens on every deploy of the demo instance — runs straight
| over the top of that work.
|
| DatabaseSeederTest already pins the shape the seeder produces. This file pins
| the *second* run: what an insert-if-absent seeder is allowed to add (nothing),
| what its one non-insert write is allowed to touch (a null threshold, and only
| a null one), and what it must never come near — a moved quantity, a moved
| preferred supplier, and the weighted ingredient cost behind both.
|
| The seeder is also asserted to write no receipts and no purchase orders at
| all. That is the §8 seeding rule in its blunt form: a fabricated receipt would
| have to bypass GoodsReceiptService, and from that moment the purchase ledger,
| the stock movements and the moving-average cost would each hold a different
| story about the same delivery.
|
*/

beforeEach(function (): void {
    $this->seed();
});

/**
 * The demonstration kitchen and the branch its stock hangs off.
 */
function verdantOps(): object
{
    $organisation = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    return (object) [
        'organisation' => $organisation,
        'branch' => OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->where('name', 'Al Quoz')
            ->sole(),
    ];
}

/**
 * One demonstration shelf's branch level, by stock-item code.
 */
function verdantLevel(string $itemCode): StockLevel
{
    $world = verdantOps();

    $item = StockItem::withoutTenancy()
        ->where('organisation_id', $world->organisation->getKey())
        ->where('code', $itemCode)
        ->sole();

    return StockLevel::withoutTenancy()
        ->where('branch_id', $world->branch->getKey())
        ->where('stock_item_id', $item->getKey())
        ->sole();
}

/**
 * One supplier/item link, by supplier code and stock-item code.
 */
function verdantLink(string $supplierCode, string $itemCode): SupplierStockItem
{
    $world = verdantOps();

    $supplier = Supplier::withoutTenancy()
        ->where('organisation_id', $world->organisation->getKey())
        ->where('code', $supplierCode)
        ->sole();

    $item = StockItem::withoutTenancy()
        ->where('organisation_id', $world->organisation->getKey())
        ->where('code', $itemCode)
        ->sole();

    return SupplierStockItem::withoutTenancy()
        ->where('supplier_id', $supplier->getKey())
        ->where('stock_item_id', $item->getKey())
        ->sole();
}

it('adds not one row when it runs a second time', function (): void {
    $counts = static fn (): array => [
        'suppliers' => Supplier::withoutTenancy()->count(),
        'contacts' => SupplierContact::withoutTenancy()->count(),
        'links' => SupplierStockItem::withoutTenancy()->count(),
        'stock items' => StockItem::withoutTenancy()->count(),
        'stock levels' => StockLevel::withoutTenancy()->count(),
    ];

    $before = $counts();

    $this->seed(OpsDemoSeeder::class);

    expect($counts())->toBe($before);
});

it('seeds no goods receipt and no purchase order, on any run', function (): void {
    // §8's seeding rule, stated as an absence. A seeded receipt would be stock
    // that arrived without a movement and money that was spent without a
    // ledger entry; a seeded order would be a document nobody issued.
    $this->seed(OpsDemoSeeder::class);

    expect(GoodsReceipt::withoutTenancy()->count())->toBe(0)
        ->and(PurchaseOrder::withoutTenancy()->count())->toBe(0);
});

it('leaves a quantity the demonstration has moved exactly where it moved it', function (): void {
    // The expensive mistake this file exists to prevent: a reseed that resets
    // the shelf a demonstrator just received forty kilograms into.
    $level = verdantLevel('chicken-breast');
    $level->quantity = '12.5000';
    $level->save();

    $this->seed(OpsDemoSeeder::class);

    expect(verdantLevel('chicken-breast')->quantity)->toBe('12.5000');
});

it('leaves a retuned threshold and par alone, and fills only the one that is null', function (): void {
    // Per column, not per row. A kitchen that retunes its reorder point keeps
    // it; a kitchen that clears one gets the demonstration value back without
    // losing the par it typed beside it.
    $lentils = verdantLevel('red-lentils');
    $lentils->reorder_threshold = '75.0000';
    $lentils->par_level = '150.0000';
    $lentils->save();

    $rice = verdantLevel('basmati-rice');
    $rice->reorder_threshold = null;
    $rice->par_level = '999.0000';
    $rice->save();

    $this->seed(OpsDemoSeeder::class);

    expect(verdantLevel('red-lentils')->reorder_threshold)->toBe('75.0000')
        ->and(verdantLevel('red-lentils')->par_level)->toBe('150.0000')
        ->and(verdantLevel('basmati-rice')->reorder_threshold)->toBe('40.0000')
        ->and(verdantLevel('basmati-rice')->par_level)->toBe('999.0000');
});

it('does not steal back a preferred supplier the demonstration moved', function (): void {
    // Basmati rice is seeded preferred to Freshmart. Moving it to Gulf Foods is
    // a decision, and `is_preferred` is written on create only so a reseed
    // cannot reverse it — nor collide with the partial unique index on the way,
    // which is what an upsert would have done with both holders still present.
    $freshmart = verdantLink('freshmart', 'basmati-rice');
    $freshmart->is_preferred = false;
    $freshmart->save();

    $gulf = verdantLink('gulf-foods', 'basmati-rice');
    $gulf->is_preferred = true;
    $gulf->save();

    $this->seed(OpsDemoSeeder::class);

    expect(verdantLink('gulf-foods', 'basmati-rice')->is_preferred)->toBeTrue()
        ->and(verdantLink('freshmart', 'basmati-rice')->is_preferred)->toBeFalse()
        ->and(SupplierStockItem::withoutTenancy()->where('stock_item_id', $gulf->stock_item_id)->where('is_preferred', true)->count())
        ->toBe(1);
});

it('leaves an edited contact detail as the demonstration edited it', function (): void {
    $world = verdantOps();

    $supplier = Supplier::withoutTenancy()
        ->where('organisation_id', $world->organisation->getKey())
        ->where('code', 'gulf-foods')
        ->sole();

    $samir = SupplierContact::withoutTenancy()
        ->where('supplier_id', $supplier->getKey())
        ->where('name', 'Samir Haddad')
        ->sole();

    $samir->phone = '+971 4 555 9999';
    $samir->is_primary = false;
    $samir->save();

    $this->seed(OpsDemoSeeder::class);

    $reloaded = SupplierContact::withoutTenancy()->whereKey($samir->getKey())->sole();

    expect($reloaded->phone)->toBe('+971 4 555 9999')
        ->and($reloaded->is_primary)->toBeFalse();
});

it('never rewrites an ingredient cost the real purchasing path recorded', function (): void {
    // The cost half of §8's exit condition. The row is written through the
    // service every priced receipt line goes through, so what is asserted here
    // is the same value a delivery would have produced — and the assertion is
    // on the raw rows, `updated_at` included, so a save that changed nothing
    // still counts as a change.
    $world = verdantOps();
    $owner = User::query()->where('email', 'owner@verdant.test')->sole();

    $chicken = Ingredient::withoutTenancy()
        ->where('organisation_id', $world->organisation->getKey())
        ->where('slug', 'chicken-breast')
        ->sole();

    $kilogram = MeasurementUnit::query()->where('code', 'kg')->sole();

    app(TenantContext::class)->setOrganisation((string) $owner->getKey(), (string) $world->organisation->getKey());

    app(IngredientCostService::class)->recordPurchase(
        (string) $world->organisation->getKey(),
        $chicken,
        '10.0000',
        $kilogram,
        '6.9000',
        'USD',
    );

    app(TenantContext::class)->clear();

    $rows = static fn (string $table): array => DB::table($table)->orderBy('id')->get()->map(
        static fn (object $row): array => (array) $row,
    )->all();

    $costsBefore = $rows('ingredient_stock_costs');
    $eventsBefore = $rows('ingredient_cost_events');

    expect($costsBefore)->toHaveCount(1)
        ->and($eventsBefore)->toHaveCount(1);

    $this->seed(OpsDemoSeeder::class);

    expect($rows('ingredient_stock_costs'))->toBe($costsBefore)
        ->and($rows('ingredient_cost_events'))->toBe($eventsBefore)
        ->and(IngredientStockCost::withoutTenancy()->count())->toBe(1)
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe(1);
});
