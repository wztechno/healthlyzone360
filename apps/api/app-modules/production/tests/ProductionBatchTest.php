<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| Cooking a batch to stock
|--------------------------------------------------------------------------
|
| A sauce is made to stock, so its raw materials and bottles have to leave the
| shelves when the batch is cooked — a sale only draws the sauce itself — and
| the sauce has to arrive with a cost, or every bottle sold afterwards is cost
| of goods of nothing. Everything below is derived from the order's recipe
| version and planned yield; nothing is typed.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('batch@kitchen.test');
    $this->organisationId = (string) $this->tenant->organisation->getKey();
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisationId,
        'country_code' => $this->tenant->organisation->country_code,
    ]);
    $this->actingAs($this->tenant->user);
    $this->headers = PricingWorld::headers($this->tenant) + [
        'X-Branch-Id' => (string) $this->branch->getKey(),
    ];

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();
});

/**
 * An ingredient on the shelf derivation gives it, holding `$held` at the branch, with a moving
 * average when `$averageCost` is given.
 *
 * @param  numeric-string  $held
 * @param  numeric-string|null  $averageCost
 */
function batchStock(object $test, string $name, MeasurementUnit $unit, string $held, ?string $averageCost): Ingredient
{
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->organisationId,
        'name_en' => $name,
        'default_unit_id' => (string) $unit->getKey(),
    ]);

    if (bccomp($held, '0', 6) === 1) {
        $test->postJson('/api/v1/catalogue/inventory/adjustments', [
            'branch_id' => (string) $test->branch->getKey(),
            'stock_item_id' => (string) shelfOf($ingredient)->getKey(),
            'quantity_delta' => (float) $held,
        ], $test->headers)->assertCreated();
    }

    if ($averageCost !== null) {
        IngredientStockCost::query()->create([
            'organisation_id' => $test->organisationId,
            'ingredient_id' => (string) $ingredient->getKey(),
            'unit_id' => (string) $unit->getKey(),
            'quantity_on_hand' => $held,
            'moving_average_cost_amount' => $averageCost,
            'last_purchase_cost_amount' => $averageCost,
            'currency_code' => 'AED',
        ]);
    }

    return $ingredient;
}

function shelfOf(Ingredient $ingredient): StockItem
{
    return StockItem::withoutTenancy()->where('ingredient_id', (string) $ingredient->getKey())->sole();
}

function heldOn(Ingredient $ingredient): string
{
    return (string) (StockLevel::withoutTenancy()->where('stock_item_id', shelfOf($ingredient)->getKey())->value('quantity') ?? '0');
}

/**
 * A version yielding 2 kg from 1.5 kg of `$base`, packed in seven `$bottle`s a batch — at a 3 %
 * production and a 10 % packaging waste rate, neither of which a batch applies.
 */
function sauceRecipe(object $test, Ingredient $base, Ingredient $bottle): RecipeVersion
{
    $recipe = Recipe::factory()->create(['organisation_id' => $test->organisationId]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $test->organisationId,
        'yield_quantity' => '2',
        'yield_unit_id' => (string) $test->kg->getKey(),
        'waste_coefficient_percent' => '3.00',
        'packaging_waste_percent' => '10.00',
    ]);

    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $test->organisationId,
        'line_number' => 1,
        'ingredient_id' => (string) $base->getKey(),
        'quantity' => '1.5',
        'unit_id' => (string) $test->kg->getKey(),
    ]);

    RecipeVersionPackaging::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $test->organisationId,
        'line_number' => 1,
        'ingredient_id' => (string) $bottle->getKey(),
        'basis' => PackagingBasis::PerBatch,
        'quantity' => '7',
        'unit_id' => (string) $test->piece->getKey(),
    ]);

    return $version;
}

/** The sauce sold from the version's recipe, whose ingredient is the shelf a bottle is sold from. */
function soldAsSauce(object $test, RecipeVersion $version, Ingredient $sauce): void
{
    $catalogue = Catalogue::factory()->create(['organisation_id' => $test->organisationId]);

    CatalogueItem::factory()->sauce()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $test->organisationId,
        'recipe_id' => $version->recipe_id,
        'ingredient_id' => (string) $sauce->getKey(),
    ]);
}

function plannedBatch(object $test, RecipeVersion $version, ?float $plannedYield): string
{
    return (string) $test->postJson('/api/v1/catalogue/production/orders', [
        'branch_id' => (string) $test->branch->getKey(),
        'recipe_version_id' => (string) $version->getKey(),
        'planned_yield' => $plannedYield,
    ], $test->headers)->assertCreated()->json('data.production_order.id');
}

it('cooks a sauce to stock: its inputs and bottles leave their shelves, and the sauce arrives valued', function (): void {
    $base = batchStock($this, 'Mayonnaise base', $this->kg, '10', '2.000000');
    $bottle = batchStock($this, 'Bottle 300', $this->piece, '100', '0.250000');
    $sauce = batchStock($this, 'Garlic sauce', $this->kg, '0', null);
    $version = sauceRecipe($this, $base, $bottle);
    soldAsSauce($this, $version, $sauce);

    // Three kilograms of a two-kilogram recipe: one and a half batches.
    $orderId = plannedBatch($this, $version, 3);

    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.production_order.status', 'completed')
        ->assertJsonPath('data.production_order.yield_valued', true);

    // 1.5 kg × 1.5 batches, and no 3 % uplift: the sheets state process loss on the output.
    expect(heldOn($base))->toBe('7.7500')
        // Seven bottles × 1.5 is 10.5, and half a bottle never left a shelf — 11, with no 10 % uplift.
        ->and(heldOn($bottle))->toBe('89.0000')
        ->and(heldOn($sauce))->toBe('3.0000');

    // 2.25 kg at 2.00 plus 11 bottles at 0.25 is 7.25, for 3 kg made.
    $yield = StockMovement::withoutTenancy()->where('reference_id', $orderId)->where('reason', 'yield')->sole();
    expect((string) $yield->cost_amount)->toBe('7.250000')
        ->and($yield->cost_currency_code)->toBe('AED');

    $made = IngredientStockCost::withoutTenancy()->where('ingredient_id', (string) $sauce->getKey())->sole();
    expect((string) $made->moving_average_cost_amount)->toBe('2.416667')
        ->and((string) $made->quantity_on_hand)->toBe('3.000000');

    // An input's average loses the quantity taken and keeps its price: only a purchase moves it.
    $input = IngredientStockCost::withoutTenancy()->where('ingredient_id', (string) $base->getKey())->sole();
    expect((string) $input->quantity_on_hand)->toBe('7.750000')
        ->and((string) $input->moving_average_cost_amount)->toBe('2.000000');
});

it('books a batch once, however many times it is completed', function (): void {
    $base = batchStock($this, 'Mayonnaise base', $this->kg, '10', '2.000000');
    $bottle = batchStock($this, 'Bottle 300', $this->piece, '100', '0.250000');
    $sauce = batchStock($this, 'Garlic sauce', $this->kg, '0', null);
    $version = sauceRecipe($this, $base, $bottle);
    soldAsSauce($this, $version, $sauce);
    $orderId = plannedBatch($this, $version, 3);

    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)->assertOk();
    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.production_order.yield_valued', true);

    expect(heldOn($base))->toBe('7.7500')
        ->and(heldOn($sauce))->toBe('3.0000')
        ->and(StockMovement::withoutTenancy()->where('reference_id', $orderId)->where('reason', 'yield')->count())->toBe(1);
});

it('refuses a batch the shelves cannot supply, names the shelf, and moves nothing', function (): void {
    $base = batchStock($this, 'Mayonnaise base', $this->kg, '1', '2.000000');
    $bottle = batchStock($this, 'Bottle 300', $this->piece, '100', '0.250000');
    $sauce = batchStock($this, 'Garlic sauce', $this->kg, '0', null);
    $version = sauceRecipe($this, $base, $bottle);
    soldAsSauce($this, $version, $sauce);
    $orderId = plannedBatch($this, $version, 3);

    $response = $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'inventory.insufficient_stock');

    expect($response->json('error.message'))->toContain('Mayonnaise base')
        ->and(heldOn($base))->toBe('1.0000')
        ->and(heldOn($bottle))->toBe('100.0000')
        ->and(heldOn($sauce))->toBe('0')
        ->and(ProductionOrder::withoutTenancy()->whereKey($orderId)->value('status'))->toBe('planned');
});

it('refuses a recipe that makes nothing kept on a shelf', function (): void {
    // No output declared and no sauce sold from it: what a meal's recipe looks like. A meal is
    // cooked when it is ordered, and booking a batch of one would take its ingredients twice.
    $base = batchStock($this, 'Mayonnaise base', $this->kg, '10', '2.000000');
    $bottle = batchStock($this, 'Bottle 300', $this->piece, '100', '0.250000');
    $version = sauceRecipe($this, $base, $bottle);
    $orderId = plannedBatch($this, $version, 3);

    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(heldOn($base))->toBe('10.0000');
});

it('lands a batch unvalued when an input has no cost, and leaves the sauce’s average alone', function (): void {
    $base = batchStock($this, 'Mayonnaise base', $this->kg, '10', '2.000000');
    $bottle = batchStock($this, 'Bottle 300', $this->piece, '100', null);
    $sauce = batchStock($this, 'Garlic sauce', $this->kg, '0', null);
    $version = sauceRecipe($this, $base, $bottle);
    soldAsSauce($this, $version, $sauce);
    $orderId = plannedBatch($this, $version, 3);

    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.production_order.yield_valued', false);

    // The shelves move; the cost does not get invented. An average built on the base alone would
    // understate every bottle sold after it by the bottles' cost.
    expect(heldOn($sauce))->toBe('3.0000')
        ->and(IngredientStockCost::withoutTenancy()->where('ingredient_id', (string) $sauce->getKey())->exists())->toBeFalse();
});

it('stocks what a version declares it makes, one batch as written when nothing is planned', function (): void {
    $base = batchStock($this, 'Basil', $this->kg, '10', '2.000000');
    $bottle = batchStock($this, 'Tub 1 kg', $this->piece, '100', '0.250000');
    $mix = batchStock($this, 'Pesto mix', $this->kg, '0', null);
    $version = sauceRecipe($this, $base, $bottle);

    RecipeVersionOutput::factory()->primary()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->organisationId,
        'ingredient_id' => (string) $mix->getKey(),
        'output_quantity' => '1.8',
        'unit_id' => (string) $this->kg->getKey(),
    ]);

    $orderId = plannedBatch($this, $version, null);

    $this->postJson("/api/v1/catalogue/production/orders/{$orderId}/complete", [], $this->headers)->assertOk();

    // The declared 1.8 kg rather than the stated 2 kg yield: an intermediate states what it makes.
    expect(heldOn($mix))->toBe('1.8000')
        ->and(heldOn($base))->toBe('8.5000')
        ->and(heldOn($bottle))->toBe('93.0000');
});
