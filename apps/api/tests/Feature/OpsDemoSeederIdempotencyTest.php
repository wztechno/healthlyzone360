<?php

declare(strict_types=1);

use App\Models\User;
use Database\Seeders\OpsDemoSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\IngredientCostService;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
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
| The seeder is asserted to write no purchase orders at all, and — since PROD1 —
| to write its two demonstration receipts **through** `GoodsReceiptService` and
| exactly once. The old rule was "no receipts", and the reason was right: a
| fabricated receipt bypasses the service, and from that moment the purchase
| ledger, the stock movements and the moving-average cost each hold a different
| story about the same delivery. The objection is to the raw row, not to the
| receipt, and a demo with no purchase history has no weekly price and therefore
| no batch estimate to show. So the rule is now about *how*, and the assertions
| below pin both halves: the movements and the cost events exist behind the
| receipts, and a second run adds neither.
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
        // PROD1 gave the seeder two receipts and the recipes behind them; a
        // second run must add none of it either.
        'goods receipts' => GoodsReceipt::withoutTenancy()->count(),
        'recipes' => Recipe::withoutTenancy()->count(),
        'recipe versions' => RecipeVersion::withoutTenancy()->count(),
        'catalogue items' => CatalogueItem::withoutTenancy()->count(),
        'ingredients' => Ingredient::withoutTenancy()->count(),
    ];

    $before = $counts();

    $this->seed(OpsDemoSeeder::class);

    expect($counts())->toBe($before);
});

it('seeds no purchase order, on any run', function (): void {
    // A seeded order would be a document nobody issued. The demo shows an empty
    // order book that a demonstrator fills the way a kitchen would.
    $this->seed(OpsDemoSeeder::class);

    expect(PurchaseOrder::withoutTenancy()->count())->toBe(0);
});

it('posts its two demonstration receipts through the service, and only once', function (): void {
    // PROD1. Two completed weeks of priced deliveries, which is the only thing
    // that can give the demo a weekly average price to estimate a batch
    // against. What makes them allowable is that they went through the real
    // receiving path: each one left stock movements and cost events behind it,
    // so the ledger, the shelf and the moving average tell one story.
    $receipts = GoodsReceipt::withoutTenancy()->orderBy('document_ref')->get();

    expect($receipts)->toHaveCount(2)
        ->and($receipts->pluck('document_ref')->all())->toBe(['DEMO-PROD-W1', 'DEMO-PROD-W2']);

    $movements = StockMovement::withoutTenancy()->where('reference_type', 'goods_receipt')->count();
    $costEvents = IngredientCostEvent::withoutTenancy()->count();

    expect($movements)->toBeGreaterThan(0)
        ->and($costEvents)->toBeGreaterThan(0);

    $this->seed(OpsDemoSeeder::class);

    // A receipt is stock and money. Posting it a second time would double both,
    // which is why the guard is on the document reference rather than on a
    // count somebody has to keep in step.
    expect(GoodsReceipt::withoutTenancy()->count())->toBe(2)
        ->and(StockMovement::withoutTenancy()->where('reference_type', 'goods_receipt')->count())->toBe($movements)
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe($costEvents);
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

    // The demonstration receipts have already valued their own ingredients, so
    // the counts are whatever they are; what this test is about is that the
    // chicken's cost — and every other row beside it — comes back unchanged,
    // `updated_at` included, so a save that changed nothing still counts.
    expect($costsBefore)->not->toBeEmpty()
        ->and($eventsBefore)->not->toBeEmpty();

    $this->seed(OpsDemoSeeder::class);

    expect($rows('ingredient_stock_costs'))->toBe($costsBefore)
        ->and($rows('ingredient_cost_events'))->toBe($eventsBefore)
        ->and(IngredientStockCost::withoutTenancy()->count())->toBe(count($costsBefore))
        ->and(IngredientCostEvent::withoutTenancy()->count())->toBe(count($eventsBefore));
});
