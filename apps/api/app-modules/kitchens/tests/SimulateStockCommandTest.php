<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| kitchen:simulate-stock
|--------------------------------------------------------------------------
|
| Fake but realistic prices and stock for a development kitchen. What has to
| hold: stock enters through the receiving path, so the shelf and the cost
| ledger agree; what the kitchen makes itself is never bought; a re-run never
| doubles stock or money; and a dry run writes nothing.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    $this->kitchen = CatalogueWorld::kitchen('simulate@kitchen.test');
    $organisationId = (string) $this->kitchen->organisation->getKey();

    OrganisationBranch::factory()->create([
        'organisation_id' => $organisationId,
        'country_code' => $this->kitchen->organisation->country_code,
    ]);

    $ingredient = static fn (string $slug): Ingredient => Ingredient::factory()->create([
        'organisation_id' => $organisationId,
        'slug' => $slug,
        'default_unit_id' => CatalogueWorld::unit('kg'),
    ]);

    $this->chicken = $ingredient('chicken');
    $this->mystery = $ingredient('mystery-root');
    $this->houseSauce = $ingredient('house-garlic-sauce');

    CatalogueItem::factory()->create([
        'catalogue_id' => $this->kitchen->catalogue->getKey(),
        'organisation_id' => $organisationId,
        'item_type' => CatalogueItemType::Sauce,
        'production_mode' => ProductionMode::Production,
        'ingredient_id' => $this->houseSauce->getKey(),
        'slug' => 'house-garlic-sauce',
    ]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

function simulatedLevel(Ingredient $ingredient): ?StockLevel
{
    $item = StockItem::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->first();

    return $item === null ? null : StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->first();
}

it('receives bought ingredients at a price, with the shelf and the cost ledger agreeing', function (): void {
    expect($this->artisan('kitchen:simulate-stock', ['--org' => $this->kitchen->organisation->slug])->run())->toBe(0);

    $level = simulatedLevel($this->chicken);
    $cost = IngredientStockCost::withoutTenancy()->where('ingredient_id', $this->chicken->getKey())->sole();

    // 60 kg on hand from two deliveries, around the file's 4.80/kg; reorder at 30%, par at the full level.
    expect($level->quantity)->toBe('60.0000')
        ->and($level->reorder_threshold)->toBe('18.0000')
        ->and($level->par_level)->toBe('60.0000')
        ->and($cost->quantity_on_hand)->toBe('60.000000')
        ->and((float) $cost->moving_average_cost_amount)->toBeGreaterThan(4.5)->toBeLessThan(5.2)
        ->and((float) $cost->last_purchase_cost_amount)->toBeGreaterThan((float) $cost->moving_average_cost_amount);

    // Unknown to the file: received at the catch-all default rather than skipped.
    expect((float) simulatedLevel($this->mystery)->quantity)->toBeGreaterThan(0)
        // Made in-house: its cost is a batch's, never a supplier's.
        ->and(simulatedLevel($this->houseSauce)?->quantity ?? '0')->toBe('0');
});

it('never posts the same deliveries twice', function (): void {
    $slug = $this->kitchen->organisation->slug;

    $this->artisan('kitchen:simulate-stock', ['--org' => $slug])->run();
    $receipts = GoodsReceipt::withoutTenancy()->count();

    $this->artisan('kitchen:simulate-stock', ['--org' => $slug])->run();

    expect($receipts)->toBeGreaterThan(0)
        ->and(GoodsReceipt::withoutTenancy()->count())->toBe($receipts)
        ->and(simulatedLevel($this->chicken)->quantity)->toBe('60.0000');
});

it('writes nothing on a dry run', function (): void {
    expect($this->artisan('kitchen:simulate-stock', ['--org' => $this->kitchen->organisation->slug, '--dry-run' => true])->run())->toBe(0)
        ->and(GoodsReceipt::withoutTenancy()->count())->toBe(0)
        ->and(IngredientStockCost::withoutTenancy()->count())->toBe(0);
});

it('repairs shelves written before the checks: negative back to zero, a broken pair back to its seed', function (): void {
    expect($this->artisan('kitchen:simulate-stock', ['--org' => $this->kitchen->organisation->slug])->run())->toBe(0);

    $migration = require base_path('app-modules/kitchens/database/migrations/2026_10_10_000001_repair_stock_levels_before_checks.php');
    $migration->down();

    $chicken = simulatedLevel($this->chicken);
    $chicken->forceFill(['quantity' => '-5', 'reorder_threshold' => '56323', 'par_level' => '12'])->save();

    // A shelf the command never stocks was never seeded a pair, so it goes back to none.
    $sauceItem = StockItem::withoutTenancy()->where('ingredient_id', $this->houseSauce->getKey())->sole();
    $sauce = StockLevel::withoutTenancy()->create([
        'organisation_id' => (string) $this->kitchen->organisation->getKey(),
        'branch_id' => $chicken->branch_id,
        'stock_item_id' => (string) $sauceItem->getKey(),
        'quantity' => '1',
        'reorder_threshold' => '5',
        'par_level' => '5',
    ]);

    $migration->up();

    $chicken->refresh();
    $sauce->refresh();

    expect($chicken->quantity)->toBe('0.0000')
        ->and($chicken->reorder_threshold)->toBe('18.0000')
        ->and($chicken->par_level)->toBe('60.0000')
        ->and(StockMovement::withoutTenancy()
            ->where('stock_item_id', $chicken->stock_item_id)->where('reason', 'adjust')->value('quantity_delta'))->toBe('5.0000')
        ->and($sauce->reorder_threshold)->toBeNull()
        ->and($sauce->par_level)->toBeNull();
});
