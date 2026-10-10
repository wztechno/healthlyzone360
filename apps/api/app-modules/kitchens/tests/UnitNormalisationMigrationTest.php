<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The KG/LTR migration against a database that has been trading
|--------------------------------------------------------------------------
|
| A fresh install already has the owner's units, so the cases worth proving are
| the deployed ones: what a recorded weight lets the migration restate, what it
| quarantines or leaves when nothing can be weighed, and that it stops before
| changing anything when a held quantity would be stranded.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('unit-migration@kitchens.test');
    $this->organisationId = (string) $this->kitchen->organisation->getKey();
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisationId,
        'country_code' => $this->kitchen->organisation->country_code,
    ]);
});

function normaliseUnits(): void
{
    (require base_path('app-modules/kitchens/database/migrations/2026_09_16_000001_normalise_platform_ingredient_units.php'))->up();
}

function libraryRow(string $ref, string $unit, string $purchaseUnit, ?string $gramsPerUnit = null): Ingredient
{
    return Ingredient::factory()->create([
        'organisation_id' => null,
        'source_system' => 'healthy360_platform',
        'source_ref' => $ref,
        'default_unit_id' => RecipeWorld::unit($unit),
        'purchase_unit_id' => RecipeWorld::unit($purchaseUnit),
        'grams_per_unit' => $gramsPerUnit,
    ]);
}

function lineIn(object $test, string $status, Ingredient $ingredient, string $quantity, string $unit, ?string $unitCost = null): RecipeVersionLine
{
    $factory = RecipeVersion::factory();

    $version = ($status === 'published' ? $factory->published() : $factory)->create([
        'recipe_id' => Recipe::factory()->create(['organisation_id' => $test->organisationId])->getKey(),
        'organisation_id' => $test->organisationId,
    ]);

    return RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $test->organisationId,
        'ingredient_id' => (string) $ingredient->getKey(),
        'quantity' => $quantity,
        'unit_id' => RecipeWorld::unit($unit),
        'unit_cost_amount' => $unitCost,
        'cost_currency_code' => $unitCost === null ? null : 'USD',
    ]);
}

function shelfHolding(object $test, Ingredient $ingredient, string $unit, string $quantity, ?string $reorderAt = null): StockItem
{
    $shelf = StockItem::query()->create([
        'organisation_id' => $test->organisationId,
        'code' => 'shelf-'.$ingredient->source_ref,
        'name_en' => $ingredient->name_en,
        'unit_code' => $unit,
        'unit_id' => RecipeWorld::unit($unit),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    StockLevel::query()->create([
        'organisation_id' => $test->organisationId,
        'branch_id' => (string) $test->branch->getKey(),
        'stock_item_id' => (string) $shelf->getKey(),
        'quantity' => $quantity,
        'reorder_threshold' => $reorderAt,
    ]);

    return $shelf;
}

function balanceOf(object $test, Ingredient $ingredient, string $unit, string $quantity, string $average): void
{
    IngredientStockCost::query()->create([
        'organisation_id' => $test->organisationId,
        'ingredient_id' => (string) $ingredient->getKey(),
        'unit_id' => RecipeWorld::unit($unit),
        'quantity_on_hand' => $quantity,
        'moving_average_cost_amount' => $average,
        'last_purchase_cost_amount' => $average,
        'currency_code' => 'USD',
    ]);
}

it('restates everything a recorded weight proves, published lines included, and moves the row', function (): void {
    // Ketchup: stocked by the litre at 1150 g a litre, bought by the gallon. The table says kg.
    $ketchup = libraryRow('ING-016', 'l', 'gallon', '1150');

    // A kitchen's own ING-016, in litres. Same reference, not the platform's row.
    $fork = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'source_system' => null,
        'source_ref' => 'ING-016',
        'default_unit_id' => RecipeWorld::unit('l'),
        'grams_per_unit' => '1150',
    ]);

    $draftLine = lineIn($this, 'draft', $ketchup, '0.2', 'l', unitCost: '5.00');
    $publishedLine = lineIn($this, 'published', $ketchup, '500', 'ml');
    balanceOf($this, $ketchup, 'l', '10', '5.00');
    $shelf = shelfHolding($this, $ketchup, 'l', '4', reorderAt: '2');

    normaliseUnits();

    $kg = RecipeWorld::unit('kg');
    $row = DB::table('ingredients')->where('id', $ketchup->getKey())->first();

    expect($row->default_unit_id)->toBe($kg)
        ->and($row->purchase_unit_id)->toBe($kg)
        // A kilogram weighs what it weighs.
        ->and($row->grams_per_unit)->toBeNull()
        ->and($row->lock_version)->toBe(1)
        ->and(DB::table('ingredients')->where('id', $fork->getKey())->value('default_unit_id'))->toBe(RecipeWorld::unit('l'));

    // 0.2 l is 230 g, and a litre's price is 1.15 kilograms' worth.
    $draft = DB::table('recipe_version_lines')->where('id', $draftLine->getKey())->first();
    expect($draft->quantity)->toBe('0.2300')
        ->and($draft->unit_id)->toBe($kg)
        ->and($draft->unit_cost_amount)->toBe('4.347826');

    // Published, and restated all the same: the same grams, so the same label and the same deduction.
    $published = DB::table('recipe_version_lines')->where('id', $publishedLine->getKey())->first();
    expect($published->quantity)->toBe('0.5750')
        ->and($published->unit_id)->toBe($kg)
        ->and(DB::table('recipe_versions')->where('id', $publishedLine->recipe_version_id)->first())
        ->status->toBe('published')
        ->lock_version->toBe(1);

    $cost = DB::table('ingredient_stock_costs')->where('ingredient_id', $ketchup->getKey())->first();
    expect($cost->unit_id)->toBe($kg)
        ->and($cost->quantity_on_hand)->toBe('11.500000')
        ->and($cost->moving_average_cost_amount)->toBe('4.347826');

    $level = DB::table('stock_levels')->where('stock_item_id', $shelf->getKey())->first();
    expect(DB::table('stock_items')->where('id', $shelf->getKey())->value('unit_code'))->toBe('kg')
        ->and($level->quantity)->toBe('4.6000')
        ->and($level->reorder_threshold)->toBe('2.3000');
});

it('quarantines a draft nothing can weigh, leaves a published one selling, and moves an empty shelf', function (): void {
    // Tuna by the can-as-piece. There is no per-piece weight anywhere, so nothing restates.
    $tuna = libraryRow('ING-076', 'piece', 'can');

    $draftLine = lineIn($this, 'draft', $tuna, '2', 'piece');
    $publishedLine = lineIn($this, 'published', $tuna, '3', 'piece');
    $shelf = shelfHolding($this, $tuna, 'piece', '0', reorderAt: '5');
    balanceOf($this, $tuna, 'piece', '0', '1.50');

    normaliseUnits();

    $draft = DB::table('recipe_versions')->where('id', $draftLine->recipe_version_id)->first();
    expect($draft->status)->toBe('review_required')
        ->and($draft->review_reason)->toContain('line 1')
        ->and(DB::table('recipe_version_lines')->where('id', $draftLine->getKey())->value('unit_id'))->toBe(RecipeWorld::unit('piece'))
        ->and(DB::table('recipe_versions')->where('id', $publishedLine->recipe_version_id)->value('status'))->toBe('published')
        ->and(DB::table('recipe_version_lines')->where('id', $publishedLine->getKey())->value('quantity'))->toBe('3.0000');

    // Empty, so there is no count to misread — only a threshold set in cans, which nobody can restate.
    expect(DB::table('stock_items')->where('id', $shelf->getKey())->value('unit_id'))->toBe(RecipeWorld::unit('kg'))
        ->and(DB::table('stock_levels')->where('stock_item_id', $shelf->getKey())->value('reorder_threshold'))->toBeNull()
        // An empty balance starts again on the next receipt; nothing here needs to touch it.
        ->and(DB::table('ingredient_stock_costs')->where('ingredient_id', $tuna->getKey())->value('unit_id'))->toBe(RecipeWorld::unit('piece'))
        ->and(DB::table('ingredients')->where('id', $tuna->getKey())->value('default_unit_id'))->toBe(RecipeWorld::unit('kg'));
});

it('stops before changing anything when a held quantity would be stranded', function (): void {
    $tuna = libraryRow('ING-076', 'piece', 'can');
    $ketchup = libraryRow('ING-016', 'l', 'gallon', '1150');

    balanceOf($this, $tuna, 'piece', '12', '1.50');
    shelfHolding($this, $tuna, 'piece', '30');
    $ketchupLine = lineIn($this, 'draft', $ketchup, '0.2', 'l');

    expect(fn () => normaliseUnits())->toThrow(RuntimeException::class, 'ING-076: a cost balance of 12.000000 piece');

    // Not even the rows that could have moved: the refusal comes first.
    expect(DB::table('ingredients')->where('id', $tuna->getKey())->value('default_unit_id'))->toBe(RecipeWorld::unit('piece'))
        ->and(DB::table('ingredients')->where('id', $ketchup->getKey())->value('default_unit_id'))->toBe(RecipeWorld::unit('l'))
        ->and(DB::table('recipe_version_lines')->where('id', $ketchupLine->getKey())->value('unit_id'))->toBe(RecipeWorld::unit('l'));
});

it('leaves a library already in the table’s units alone, oils included', function (): void {
    $flour = libraryRow('ING-001', 'kg', 'kg');
    $oil = libraryRow('ING-236', 'kg', 'kg');
    $vinegar = libraryRow('ING-012', 'l', 'l', '1010');

    normaliseUnits();

    expect(DB::table('ingredients')->whereIn('id', [$flour->getKey(), $oil->getKey(), $vinegar->getKey()])->pluck('lock_version')->all())
        ->toBe([0, 0, 0])
        ->and(DB::table('ingredients')->where('id', $vinegar->getKey())->value('grams_per_unit'))->not->toBeNull();
});
