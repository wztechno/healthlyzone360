<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Procurement\Enums\WeeklyPriceSource;
use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\WeeklyLineCost;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Recipe costing at this week's prices (PROD1)
|--------------------------------------------------------------------------
|
| The estimating figure, beside the frozen one the lines carry. Three claims
| run through the file.
|
| **Nothing frozen moves.** A sheet costed in March still says what it said in
| March; this answers a different question next to it. Every test that resolves
| a weekly price also asserts the saved `unit_cost_amount` is untouched.
|
| **A produced component brings its own cost, not its ingredients.** The rule
| that stops a dressing's olive oil being counted once inside the dressing and
| again inside the salad — the same double count `OrderConsumptionService`
| avoids at sale time by drawing a sauce off its own shelf.
|
| **A price that is not there is not zero.** Every path that cannot resolve a
| figure leaves the line uncosted and withholds the total, and names the
| ingredient so somebody can go and price it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('weekly-costing@recipes.test');
    $this->organisation = $this->kitchen->organisation;
    $this->grams = RecipeWorld::unit('g');
    $this->kilograms = RecipeWorld::unit('kg');

    $this->actingAs($this->kitchen->user);
    app(TenantContext::class)->setOrganisation(
        (string) $this->kitchen->user->getKey(),
        (string) $this->organisation->getKey(),
    );

    $this->weekly = app(WeeklyRecipeCostingService::class);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/** A published weekly price for one ingredient, written the way the publisher writes it. */
function publishWeeklyPrice(
    object $organisation,
    Ingredient $ingredient,
    string $amount,
    string $unitId,
    string $weekStart = '2026-08-31',
    string $source = 'computed',
): WeeklyPricePublication {
    /** @var WeeklyPricePublication $publication */
    $publication = WeeklyPricePublication::query()->create([
        'organisation_id' => $organisation->getKey(),
        'purchase_week_start_date' => $weekStart,
        'purchase_week_end_date' => date('Y-m-d', strtotime($weekStart.' +6 days')),
        'effective_from_date' => date('Y-m-d', strtotime($weekStart.' +7 days')),
        'timezone' => 'Asia/Beirut',
        'published_at' => now(),
        'ingredient_count' => 1,
        'computed_count' => 1,
    ]);

    IngredientWeeklyPrice::query()->create([
        'organisation_id' => $organisation->getKey(),
        'weekly_price_publication_id' => $publication->getKey(),
        'ingredient_id' => $ingredient->getKey(),
        'purchase_week_start_date' => $publication->purchase_week_start_date,
        'purchase_week_end_date' => $publication->purchase_week_end_date,
        'effective_from_date' => $publication->effective_from_date,
        'unit_id' => $unitId,
        'average_unit_amount' => $amount,
        'currency_code' => 'USD',
        'total_quantity' => '10',
        'total_cost_amount' => '10',
        'receipt_line_count' => 1,
        'source' => $source,
        'carried_from_week_start_date' => $source === WeeklyPriceSource::CarriedForward->value ? '2026-08-24' : null,
    ]);

    return $publication;
}

/**
 * A version with one line per given spec.
 *
 * @param  list<array{ingredient: Ingredient, quantity: string, unit_id: string, saved_cost?: string|null}>  $lines
 * @param  array<string, mixed>  $attributes
 */
function weeklyVersion(object $kitchen, array $lines, array $attributes = []): RecipeVersion
{
    $recipe = Recipe::factory()->create(['organisation_id' => $kitchen->organisation->getKey()]);

    /** @var RecipeVersion $version */
    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $kitchen->organisation->getKey(),
    ] + $attributes);

    foreach ($lines as $index => $line) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $kitchen->organisation->getKey(),
            'ingredient_id' => $line['ingredient']->getKey(),
            'line_number' => $index + 1,
            'quantity' => $line['quantity'],
            'unit_id' => $line['unit_id'],
            'unit_cost_amount' => $line['saved_cost'] ?? null,
            'cost_currency_code' => ($line['saved_cost'] ?? null) === null ? null : 'USD',
        ]);
    }

    return $version->refresh();
}

it('costs a line at the published weekly price, restated into the line unit', function (): void {
    $flour = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Flour');
    $flour->default_unit_id = $this->kilograms;
    $flour->save();

    publishWeeklyPrice($this->organisation, $flour, '4.000000', $this->kilograms);

    // The line is written in grams against a price published per kilogram. A
    // price is per unit, so it converts the opposite way to a quantity: 4.00 a
    // kilo is 0.004 a gram, and 500 g is 2.00.
    $version = weeklyVersion($this->kitchen, [
        ['ingredient' => $flour, 'quantity' => '500', 'unit_id' => $this->grams, 'saved_cost' => '0.001'],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms, 'waste_coefficient_percent' => '0']);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $version);

    expect($result->production->totalInputCostAmount)->toBe('2.000000')
        ->and($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_WEEKLY)
        ->and($result->lineSources[1]->unitCostAmount)->toBe('0.004000')
        ->and($result->lineSources[1]->effectiveFrom)->toBe('2026-09-07');

    // The frozen figure on the row is untouched: 500 g at the saved 0.001 is
    // 0.50, which is what the sheet was costed at and still says.
    expect((string) RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->sole()->unit_cost_amount)
        ->toBe('0.001000');
});

it('costs a produced component from its own recipe, not from its ingredients', function (): void {
    // A dressing made from oil. The oil is bought; the dressing is not.
    $oil = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Olive oil');
    $oil->default_unit_id = $this->kilograms;
    $oil->save();
    publishWeeklyPrice($this->organisation, $oil, '10.000000', $this->kilograms);

    $dressing = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Caesar dressing');
    $dressing->default_unit_id = $this->kilograms;
    $dressing->save();

    // 2 kg of oil makes 4 kg of dressing: 20.00 over 4 kg is 5.00 a kilo.
    $dressingVersion = weeklyVersion($this->kitchen, [
        ['ingredient' => $oil, 'quantity' => '2', 'unit_id' => $this->kilograms],
    ], [
        'status' => RecipeVersionStatus::Published->value,
        'yield_quantity' => '4',
        'yield_unit_id' => $this->kilograms,
        'waste_coefficient_percent' => '0',
    ]);

    RecipeVersionOutput::query()->create([
        'recipe_version_id' => $dressingVersion->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => $dressing->getKey(),
        'output_quantity' => '4',
        'unit_id' => $this->kilograms,
        'is_primary' => true,
    ]);

    $dressing->nutrition_derived_from_version_id = (string) $dressingVersion->getKey();
    $dressing->save();

    // A salad taking 0.5 kg of the dressing.
    $salad = weeklyVersion($this->kitchen, [
        ['ingredient' => $dressing, 'quantity' => '0.5', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms, 'waste_coefficient_percent' => '0']);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $salad);

    // 0.5 kg at 5.00 = 2.50. Not the oil's 10.00 a kilo, and not the oil again
    // on top of the dressing.
    expect($result->production->totalInputCostAmount)->toBe('2.500000')
        ->and($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_COMPONENT)
        ->and($result->lineSources[1]->unitCostAmount)->toBe('5.000000')
        ->and($result->lineSources[1]->sourceRecipeVersionId)->toBe((string) $dressingVersion->getKey());
});

it('withholds a component whose own formulation is only part priced', function (): void {
    $oil = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Olive oil');
    $oil->default_unit_id = $this->kilograms;
    $oil->save();
    publishWeeklyPrice($this->organisation, $oil, '10.000000', $this->kilograms);

    // Lemon has no price anywhere, so the dressing cannot be wholly costed.
    $lemon = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Lemon');
    $lemon->default_unit_id = $this->kilograms;
    $lemon->purchase_price_amount = null;
    $lemon->purchase_price_currency = null;
    $lemon->save();

    $dressing = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Caesar dressing');
    $dressing->default_unit_id = $this->kilograms;
    $dressing->save();

    $dressingVersion = weeklyVersion($this->kitchen, [
        ['ingredient' => $oil, 'quantity' => '2', 'unit_id' => $this->kilograms],
        ['ingredient' => $lemon, 'quantity' => '1', 'unit_id' => $this->kilograms],
    ], [
        'status' => RecipeVersionStatus::Published->value,
        'yield_quantity' => '4',
        'yield_unit_id' => $this->kilograms,
    ]);

    RecipeVersionOutput::query()->create([
        'recipe_version_id' => $dressingVersion->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => $dressing->getKey(),
        'output_quantity' => '4',
        'unit_id' => $this->kilograms,
        'is_primary' => true,
    ]);

    $dressing->nutrition_derived_from_version_id = (string) $dressingVersion->getKey();
    $dressing->purchase_price_amount = null;
    $dressing->purchase_price_currency = null;
    $dressing->save();

    $salad = weeklyVersion($this->kitchen, [
        ['ingredient' => $dressing, 'quantity' => '0.5', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms]);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $salad);

    // A component contributing a total that quietly omitted the lemon would make
    // the salad read as fully costed. Withheld instead, and named.
    expect($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_NONE)
        ->and($result->production->isComplete())->toBeFalse()
        ->and($result->production->uncostedLineNumbers)->toBe([1])
        ->and($result->ingredientsNeedingInitialPrice())->toBe([(string) $dressing->getKey()]);
});

it('terminates when two versions each produce what the other consumes', function (): void {
    $first = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Component A');
    $second = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Component B');

    foreach ([$first, $second] as $ingredient) {
        $ingredient->default_unit_id = $this->kilograms;
        $ingredient->purchase_price_amount = null;
        $ingredient->purchase_price_currency = null;
        $ingredient->save();
    }

    // A is made from B, and B is made from A. A real shape in an imported
    // catalogue, and one a costing pass without a guard would never return from.
    $makesFirst = weeklyVersion($this->kitchen, [
        ['ingredient' => $second, 'quantity' => '1', 'unit_id' => $this->kilograms],
    ], ['status' => RecipeVersionStatus::Published->value, 'yield_quantity' => '1', 'yield_unit_id' => $this->kilograms]);

    $makesSecond = weeklyVersion($this->kitchen, [
        ['ingredient' => $first, 'quantity' => '1', 'unit_id' => $this->kilograms],
    ], ['status' => RecipeVersionStatus::Published->value, 'yield_quantity' => '1', 'yield_unit_id' => $this->kilograms]);

    foreach ([[$makesFirst, $first], [$makesSecond, $second]] as [$version, $ingredient]) {
        RecipeVersionOutput::query()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->organisation->getKey(),
            'ingredient_id' => $ingredient->getKey(),
            'output_quantity' => '1',
            'unit_id' => $this->kilograms,
            'is_primary' => true,
        ]);

        $ingredient->nutrition_derived_from_version_id = (string) $version->getKey();
        $ingredient->save();
    }

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $makesFirst);

    expect($result->production->uncostedLineNumbers)->toBe([1]);
});

it('falls back to the typed purchase price, and says that is what it did', function (): void {
    $spice = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Sumac');
    $spice->default_unit_id = $this->kilograms;
    $spice->purchase_unit_id = null;
    $spice->purchase_price_amount = '20.000000';
    $spice->purchase_price_currency = 'usd';
    $spice->save();

    $version = weeklyVersion($this->kitchen, [
        ['ingredient' => $spice, 'quantity' => '0.25', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms, 'waste_coefficient_percent' => '0']);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $version);

    expect($result->production->totalInputCostAmount)->toBe('5.000000')
        ->and($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_FALLBACK)
        ->and($result->lineSources[1]->currencyCode)->toBe('USD')
        ->and($result->lineSources[1]->effectiveFrom)->toBeNull()
        // A typed price is somebody's expectation rather than what was paid, so
        // the ingredient still belongs on the initial-price-entry list.
        ->and($result->ingredientsNeedingInitialPrice())->toBe([(string) $spice->getKey()]);
});

it('leaves a line with no price anywhere uncosted rather than free', function (): void {
    $mystery = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Unpriced thing');
    $mystery->default_unit_id = $this->kilograms;
    $mystery->purchase_price_amount = null;
    $mystery->purchase_price_currency = null;
    $mystery->save();

    $version = weeklyVersion($this->kitchen, [
        ['ingredient' => $mystery, 'quantity' => '3', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms]);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $version);

    expect($result->production->totalInputCostAmount)->toBe('0.000000')
        ->and($result->production->isComplete())->toBeFalse()
        ->and($result->production->currencyCode)->toBeNull()
        ->and($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_NONE)
        ->and($result->lineSources[1]->unitCostAmount)->toBeNull();
});

it('reads one publication when asked, so a historical estimate cannot move', function (): void {
    $flour = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Flour');
    $flour->default_unit_id = $this->kilograms;
    $flour->save();

    $august = publishWeeklyPrice($this->organisation, $flour, '4.000000', $this->kilograms, '2026-08-24');
    publishWeeklyPrice($this->organisation, $flour, '9.000000', $this->kilograms, '2026-08-31');

    $version = weeklyVersion($this->kitchen, [
        ['ingredient' => $flour, 'quantity' => '1', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms, 'waste_coefficient_percent' => '0']);

    $now = $this->weekly->cost((string) $this->organisation->getKey(), $version);
    $pinned = $this->weekly->cost((string) $this->organisation->getKey(), $version, null, null, (string) $august->getKey());

    expect($now->production->totalInputCostAmount)->toBe('9.000000')
        ->and($pinned->production->totalInputCostAmount)->toBe('4.000000')
        ->and($pinned->weeklyPricePublicationId)->toBe((string) $august->getKey());
});

it('reports a carried-forward price as one', function (): void {
    $flour = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Flour');
    $flour->default_unit_id = $this->kilograms;
    $flour->save();

    publishWeeklyPrice($this->organisation, $flour, '4.000000', $this->kilograms, '2026-08-31', WeeklyPriceSource::CarriedForward->value);

    $version = weeklyVersion($this->kitchen, [
        ['ingredient' => $flour, 'quantity' => '1', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms]);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $version);

    // The figure is usable and its age is not hidden: a kitchen reading an
    // estimate built on a fortnight-old price should be told so.
    expect($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_WEEKLY)
        ->and($result->lineSources[1]->carriedForward)->toBeTrue()
        ->and($result->hasCarriedForwardPrices())->toBeTrue();
});

it('prefers what was actually paid over what it would cost to make', function (): void {
    // An article the kitchen both makes and buys — `production_mode = both`,
    // which exists because several articles are produced when volume allows and
    // bought in when it does not. A real invoice beats this system's opinion of
    // what it should have cost.
    $oil = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Olive oil');
    $oil->default_unit_id = $this->kilograms;
    $oil->save();
    publishWeeklyPrice($this->organisation, $oil, '10.000000', $this->kilograms);

    $dressing = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Caesar dressing');
    $dressing->default_unit_id = $this->kilograms;
    $dressing->save();

    $dressingVersion = weeklyVersion($this->kitchen, [
        ['ingredient' => $oil, 'quantity' => '2', 'unit_id' => $this->kilograms],
    ], ['status' => RecipeVersionStatus::Published->value, 'yield_quantity' => '4', 'yield_unit_id' => $this->kilograms]);

    RecipeVersionOutput::query()->create([
        'recipe_version_id' => $dressingVersion->getKey(),
        'organisation_id' => $this->organisation->getKey(),
        'ingredient_id' => $dressing->getKey(),
        'output_quantity' => '4',
        'unit_id' => $this->kilograms,
        'is_primary' => true,
    ]);

    $dressing->nutrition_derived_from_version_id = (string) $dressingVersion->getKey();
    $dressing->save();

    // It was also bought this week, at 7.00 rather than the 5.00 it costs to make.
    publishWeeklyPrice($this->organisation, $dressing, '7.000000', $this->kilograms, '2026-09-07');

    $salad = weeklyVersion($this->kitchen, [
        ['ingredient' => $dressing, 'quantity' => '1', 'unit_id' => $this->kilograms],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms, 'waste_coefficient_percent' => '0']);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $salad);

    expect($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_WEEKLY)
        ->and($result->production->totalInputCostAmount)->toBe('7.000000');
});

it('refuses to price a bag as a can', function (): void {
    $boxed = RecipeWorld::verifiedCleanIngredient($this->organisation, 'Boxed thing');
    $pack = (string) MeasurementUnit::query()->where('code', 'pack')->sole()->getKey();
    $bag = (string) MeasurementUnit::query()->where('code', 'bag')->sole()->getKey();

    $boxed->default_unit_id = $pack;
    $boxed->purchase_price_amount = null;
    $boxed->purchase_price_currency = null;
    $boxed->save();

    publishWeeklyPrice($this->organisation, $boxed, '3.000000', $pack);

    $version = weeklyVersion($this->kitchen, [
        ['ingredient' => $boxed, 'quantity' => '2', 'unit_id' => $bag],
    ], ['yield_quantity' => '1', 'yield_unit_id' => $this->kilograms]);

    $result = $this->weekly->cost((string) $this->organisation->getKey(), $version);

    // Every `package`-dimension unit carries base_ratio 1, so a bare ratio
    // division would have converted one-for-one and called a bag a can.
    expect($result->lineSources[1]->source)->toBe(WeeklyLineCost::SOURCE_NONE)
        ->and($result->production->uncostedLineNumbers)->toBe([1]);
});
