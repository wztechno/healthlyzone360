<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\DraftCostService;
use Healthy360\Recipes\Services\PackCost;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| What one sold pack costs (plan S4, S5)
|--------------------------------------------------------------------------
|
| contents = fill × production cost (with production waste); packaging = each
| item at its own waste rate; a cost is complete or it is withheld, with the
| reason. Most cases go through the roll-up preview, which is where the editor
| reads them; the saved-version entry point and the parity with Dish margins'
| source are asserted at the service.
|
| The draft below costs 10.00 over a 2 kg yield cut into 4 pieces at 10%
| waste: 5.50 a kilogram and 2.75 a piece, each with the waste on it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('pack-cost@recipes.test');
    $this->organisation = $this->kitchen->organisation;
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->kilograms = RecipeWorld::unit('kg');

    $this->actingAs($this->kitchen->user);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * The roll-up preview's `computed_cost.packs` for the 10.00 / 2 kg / 4-piece / 10% draft.
 *
 * @param  list<array<string, mixed>>  $packs
 * @param  array<string, mixed>  $overrides
 * @return list<array<string, mixed>>
 */
function previewPackCosts(object $test, array $packs, array $overrides = []): array
{
    $ingredient = RecipeWorld::verifiedCleanIngredient($test->organisation, 'Hummus base');

    return $test->postJson('/api/v1/catalogue/recipes/roll-up-preview', $overrides + [
        'recipe_id' => null,
        'servings' => 1,
        'waste_percent' => 10,
        'yield_quantity' => '2',
        'yield_unit_id' => $test->kilograms,
        'yield_piece_count' => 4,
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '1',
            'unit_id' => $test->kilograms,
            'unit_cost_amount' => '10',
            'cost_currency_code' => 'USD',
        ]],
        'packs' => $packs,
    ], $test->headers)->assertOk()->json('data.computed_cost.packs');
}

/** @return array{ingredient_id: string, quantity: int|string, is_container: bool} */
function packComponent(Ingredient $item, bool $container = false, int|string $quantity = 1): array
{
    return ['ingredient_id' => (string) $item->getKey(), 'quantity' => $quantity, 'is_container' => $container];
}

it('costs a kilogram pack: the fill at the production cost, plus each item', function (): void {
    $tub = RecipeWorld::packagingItem($this->organisation, 'Tub 500', '0.40', '0.5');
    $lid = RecipeWorld::packagingItem($this->organisation, 'Lid', '0.10');

    $packs = previewPackCosts($this, [
        ['key' => 'half-kilo', 'fill_quantity' => 0.5, 'fill_unit' => 'kg', 'components' => [packComponent($tub, true), packComponent($lid)]],
    ]);

    // 0.5 kg × 5.50 = 2.75; 0.40 + 0.10 = 0.50.
    expect($packs)->toBe([[
        'key' => 'half-kilo',
        'contents_amount' => '2.750000',
        'packaging_amount' => '0.500000',
        'cost_amount' => '3.250000',
        'withheld_reason' => null,
    ]]);
});

it('reads a litre or millilitre fill as the same weight', function (): void {
    $bottle = RecipeWorld::packagingItem($this->organisation, 'Bottle 250', '0.30', '250', 'ml');

    $packs = previewPackCosts($this, [
        ['key' => 'ml', 'fill_quantity' => 250, 'fill_unit' => 'ml', 'components' => [packComponent($bottle, true)]],
        ['key' => 'l', 'fill_quantity' => 1, 'fill_unit' => 'l', 'components' => [packComponent($bottle, true)]],
    ]);

    // 250 ml is 0.25 kg (owner ruling 4): 0.25 × 5.50 = 1.375. A litre is a kilo: 5.50.
    expect($packs[0]['contents_amount'])->toBe('1.375000')
        ->and($packs[0]['cost_amount'])->toBe('1.675000')
        ->and($packs[1]['contents_amount'])->toBe('5.500000')
        ->and($packs[1]['cost_amount'])->toBe('5.800000');
});

it('costs a piece pack at the production cost per piece', function (): void {
    $box = RecipeWorld::packagingItem($this->organisation, 'Box', '0.20');

    $packs = previewPackCosts($this, [
        ['key' => 'pair', 'fill_quantity' => 2, 'fill_unit' => 'piece', 'components' => [packComponent($box, true)]],
    ]);

    // 2 × 2.75 = 5.50, plus the box.
    expect($packs[0]['contents_amount'])->toBe('5.500000')
        ->and($packs[0]['cost_amount'])->toBe('5.700000');
});

it('applies each packaging item its own waste, and prices it per piece of its purchase pack', function (): void {
    $bottle = RecipeWorld::packagingItem($this->organisation, 'Bottle', '0.40', '0.5');
    $bottle->waste_percent = '10';
    $bottle->save();

    // Bought as a case of 50 at 5.00: 0.10 a cap, no waste.
    $cap = RecipeWorld::packagingItem($this->organisation, 'Cap', '5.00');
    $cap->items_per_unit = '50';
    $cap->save();

    $packs = previewPackCosts($this, [
        ['key' => 'k', 'fill_quantity' => 0.5, 'fill_unit' => 'kg', 'components' => [packComponent($bottle, true), packComponent($cap, false, 2)]],
    ]);

    // 0.40 × 1.10 = 0.44; 2 × 0.10 = 0.20.
    expect($packs[0]['packaging_amount'])->toBe('0.640000')
        ->and($packs[0]['cost_amount'])->toBe('3.390000');
});

it('withholds the packaging and the cost, with the reason, and keeps the contents where it can', function (): void {
    $tub = RecipeWorld::packagingItem($this->organisation, 'Tub', '0.40', '0.5');
    $label = RecipeWorld::packagingItem($this->organisation, 'Label', '0.05');
    $unpriced = RecipeWorld::packagingItem($this->organisation, 'Unpriced tub', '0.40', '0.5');
    $unpriced->purchase_price_amount = null;
    $unpriced->purchase_price_currency = null;
    $unpriced->save();

    $packs = previewPackCosts($this, [
        ['key' => 'none', 'fill_quantity' => 0.5, 'fill_unit' => 'kg', 'components' => []],
        ['key' => 'no-container', 'fill_quantity' => 0.5, 'fill_unit' => 'kg', 'components' => [packComponent($label)]],
        ['key' => 'unpriced', 'fill_quantity' => 0.5, 'fill_unit' => 'kg', 'components' => [packComponent($unpriced, true), packComponent($tub)]],
        ['key' => 'bag', 'fill_quantity' => 1, 'fill_unit' => 'bag', 'components' => [packComponent($tub, true)]],
    ]);

    expect(array_column($packs, 'withheld_reason', 'key'))->toBe([
        'none' => 'packaging_unknown',
        'no-container' => 'packaging_unknown',
        'unpriced' => 'packaging_unpriced',
        'bag' => 'unit_unsupported',
    ])
        ->and(array_column($packs, 'contents_amount', 'key'))->toBe([
            'none' => '2.750000',
            'no-container' => '2.750000',
            'unpriced' => '2.750000',
            'bag' => null,
        ])
        ->and(array_unique(array_column($packs, 'packaging_amount')))->toBe([null])
        ->and(array_unique(array_column($packs, 'cost_amount')))->toBe([null]);
});

it('withholds a pack whose production is incomplete, and a piece pack with no piece count', function (): void {
    $tub = RecipeWorld::packagingItem($this->organisation, 'Tub', '0.40', '0.5');

    $priced = previewPackCosts($this, [
        ['key' => 'pieces', 'fill_quantity' => 1, 'fill_unit' => 'piece', 'components' => [packComponent($tub, true)]],
    ], ['yield_piece_count' => null]);

    $mystery = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Unpriced thing');
    $mystery->purchase_price_amount = null;
    $mystery->purchase_price_currency = null;
    $mystery->save();

    $unpriced = previewPackCosts($this, [
        ['key' => 'kilo', 'fill_quantity' => 1, 'fill_unit' => 'kg', 'components' => [packComponent($tub, true)]],
    ], ['lines' => [['ingredient_id' => (string) $mystery->getKey(), 'quantity' => '1', 'unit_id' => $this->kilograms]]]);

    expect($priced[0]['withheld_reason'])->toBe('no_piece_count')
        ->and($priced[0]['contents_amount'])->toBeNull()
        ->and($unpriced[0]['withheld_reason'])->toBe('production_incomplete')
        ->and($unpriced[0]['contents_amount'])->toBeNull();
});

it('refuses a weight fill against a yield counted in pieces', function (): void {
    $tub = RecipeWorld::packagingItem($this->organisation, 'Tub', '0.40', '0.5');

    $packs = previewPackCosts($this, [
        ['key' => 'kilo', 'fill_quantity' => 1, 'fill_unit' => 'kg', 'components' => [packComponent($tub, true)]],
    ], ['yield_unit_id' => RecipeWorld::unit('piece')]);

    expect($packs[0]['withheld_reason'])->toBe('unit_unsupported');
});

it('answers one entry per requested pack, in request order, and none when none was asked', function (): void {
    $tub = RecipeWorld::packagingItem($this->organisation, 'Tub', '0.40', '0.5');

    $packs = previewPackCosts($this, [
        ['key' => 'b', 'fill_quantity' => 1, 'fill_unit' => 'kg', 'components' => [packComponent($tub, true)]],
        ['key' => 'a', 'fill_quantity' => 0.5, 'fill_unit' => 'kg', 'components' => [packComponent($tub, true)]],
    ]);

    expect(array_column($packs, 'key'))->toBe(['b', 'a'])
        ->and(previewPackCosts($this, []))->toBe([]);

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'lines' => [],
        'packs' => [['key' => 'x', 'fill_quantity' => 0, 'fill_unit' => 'kg', 'components' => []]],
    ], $this->headers)->assertUnprocessable();
});

/**
 * A published version with one line per spec, priced from the catalogue only.
 *
 * @param  list<array{ingredient: Ingredient, quantity: string}>  $lines
 * @param  array<string, mixed>  $attributes
 */
function packCostVersion(object $test, array $lines, array $attributes): RecipeVersion
{
    $recipe = Recipe::factory()->create(['organisation_id' => $test->organisation->getKey()]);

    /** @var RecipeVersion $version */
    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'status' => RecipeVersionStatus::Published->value,
    ] + $attributes);

    foreach ($lines as $index => $line) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $test->organisation->getKey(),
            'ingredient_id' => $line['ingredient']->getKey(),
            'line_number' => $index + 1,
            'quantity' => $line['quantity'],
            'unit_id' => $test->kilograms,
            'unit_cost_amount' => null,
            'cost_currency_code' => null,
        ]);
    }

    return $version->refresh();
}

/** An ingredient priced per kilogram by its typed purchase price. */
function packCostTypedIngredient(object $test, string $name, ?string $price): Ingredient
{
    $ingredient = RecipeWorld::verifiedCleanIngredient($test->organisation, $name);
    $ingredient->default_unit_id = $test->kilograms;
    $ingredient->purchase_unit_id = null;
    $ingredient->purchase_price_amount = $price;
    $ingredient->purchase_price_currency = $price === null ? null : 'USD';
    $ingredient->save();

    return $ingredient;
}

/**
 * A preparation: 2 kg of oil at a typed 10.00 makes 4 kg of sauce at 10% waste, so the sauce
 * costs 5.50 a kilogram to make — while its own typed price says 9.00.
 */
function packCostPreparation(object $test): Ingredient
{
    $oil = packCostTypedIngredient($test, 'Olive oil', '10.000000');
    $sauce = packCostTypedIngredient($test, 'Garlic sauce', '9.000000');

    $preparation = packCostVersion($test, [['ingredient' => $oil, 'quantity' => '2']], [
        'yield_quantity' => '4',
        'yield_unit_id' => $test->kilograms,
        'waste_coefficient_percent' => '10',
    ]);

    RecipeVersionOutput::query()->create([
        'recipe_version_id' => $preparation->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'ingredient_id' => $sauce->getKey(),
        'output_quantity' => '4',
        'unit_id' => $test->kilograms,
        'is_primary' => true,
    ]);

    $sauce->nutrition_derived_from_version_id = (string) $preparation->getKey();
    $sauce->save();

    return $sauce;
}

it('costs a preparation the same from the draft preview as from Dish margins\' source', function (): void {
    app(TenantContext::class)->setOrganisation((string) $this->kitchen->user->getKey(), (string) $this->organisation->getKey());

    $sauce = packCostPreparation($this);

    $parent = packCostVersion($this, [['ingredient' => $sauce, 'quantity' => '1']], [
        'yield_quantity' => '1',
        'yield_unit_id' => $this->kilograms,
        'waste_coefficient_percent' => '0',
    ]);

    $weekly = app(WeeklyRecipeCostingService::class)->cost((string) $this->organisation->getKey(), $parent);

    $draft = app(DraftCostService::class)->cost(
        [['ingredient_id' => (string) $sauce->getKey(), 'quantity' => '1', 'unit_id' => $this->kilograms]],
        [],
        '1',
        $this->kilograms,
        null,
        '0',
        '0',
    );

    // The recipe that makes it (5.50), not the sauce's typed 9.00 — on both paths.
    expect($weekly->production->costPerYieldUnitWithWasteAmount)->toBe('5.500000')
        ->and($draft['production']->costPerYieldUnitWithWasteAmount)->toBe('5.500000');

    // And over HTTP, through the roll-up preview the editor reads.
    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'waste_percent' => 0,
        'yield_quantity' => '1',
        'yield_unit_id' => $this->kilograms,
        'lines' => [['ingredient_id' => (string) $sauce->getKey(), 'quantity' => '1', 'unit_id' => $this->kilograms]],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.computed_cost.production.cost_per_yield_unit_with_waste_amount', '5.500000');
});

it('costs packs over a saved published version at the live production cost', function (): void {
    $sauce = packCostPreparation($this);
    $bottle = RecipeWorld::packagingItem($this->organisation, 'Bottle', '0.40', '0.5');

    $packs = app(PackCost::class)->forVersion(
        RecipeVersion::withoutTenancy()->whereKey($sauce->nutrition_derived_from_version_id)->sole(),
        [
            ['key' => 'saved-pack', 'fill_quantity' => '0.5', 'fill_unit' => 'kg', 'components' => [
                ['ingredient_id' => (string) $bottle->getKey(), 'quantity' => '1', 'is_container' => true],
            ]],
        ],
    );

    // 0.5 kg at 5.50 = 2.75, plus the bottle.
    expect($packs)->toBe([[
        'key' => 'saved-pack',
        'contents_amount' => '2.750000',
        'packaging_amount' => '0.400000',
        'cost_amount' => '3.150000',
        'withheld_reason' => null,
    ]]);
});

it('withholds a saved version with no yield as no_yield', function (): void {
    $oil = packCostTypedIngredient($this, 'Olive oil', '10.000000');
    $version = packCostVersion($this, [['ingredient' => $oil, 'quantity' => '1']], [
        'yield_quantity' => null,
        'yield_unit_id' => null,
    ]);

    $packs = app(PackCost::class)->forVersion($version, [
        ['key' => 'k', 'fill_quantity' => 1, 'fill_unit' => 'kg', 'components' => []],
    ]);

    expect($packs[0]['withheld_reason'])->toBe('no_yield')
        ->and($packs[0]['contents_amount'])->toBeNull();
});
