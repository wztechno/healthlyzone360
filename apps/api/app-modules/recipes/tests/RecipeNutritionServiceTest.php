<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Services\RecipeNutritionService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Recipe nutrition — the arithmetic, and what may be claimed
|--------------------------------------------------------------------------
|
| Three claims run through this file, and every test is one of them.
|
| **The arithmetic is exact.** Amounts are asserted as literal values, chosen
| so the inputs make them exact: 100 g of a 595 kcal ingredient is 595 kcal,
| not 594.9999999. The one place a delta appears is the per-serving
| reconciliation, where `1 ÷ 3` genuinely is not reversible, and the tolerance
| there is derived rather than guessed.
|
| **A gap is withheld, never averaged over.** An ingredient missing one of the
| seven required nutrients, a line nothing can weigh, energy stated in kJ — each
| withholds all three figures and names the ingredient. A label short by exactly
| the thing nobody recorded reads identically to a correct one.
|
| **The mass basis is stated, not assumed.** `total_grams` is the stated yield
| when that yield is a mass and Σ input grams otherwise, and the envelope says
| which. Per-100 g divides by it, so getting this wrong would make the kitchen's
| own figures disagree with the customer's.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('nutrition@recipes.test');

    $this->actingAs($this->kitchen->user);

    app(TenantContext::class)->setOrganisation(
        (string) $this->kitchen->user->getKey(),
        (string) $this->kitchen->organisation->getKey(),
    );

    $this->nutrition = app(RecipeNutritionService::class);
    $this->at = CarbonImmutable::parse('2026-09-13T10:00:00Z');
});

/**
 * The seven canonical figures for tahini, per 100 g.
 *
 * @return array<string, float|int>
 */
function tahiniPer100g(): array
{
    return ['energy' => 595, 'protein' => 17, 'carbohydrate' => 21.2, 'fat' => 53.8, 'fibre' => 9.3, 'sugars' => 0.5, 'sodium' => 115];
}

/**
 * @return array<string, float|int>
 */
function freekehPer100g(): array
{
    return ['energy' => 352, 'protein' => 12.6, 'carbohydrate' => 72.2, 'fat' => 2.3, 'fibre' => 13.1, 'sugars' => 0.8, 'sodium' => 6];
}

/**
 * The slim envelope `ingredients.nutrition_per_100g` stores, in canonical
 * units. Malformed sets — a duplicate id, energy in kJ — are written literally
 * by the tests that need them, so the shape under test is visible in the test.
 *
 * @param  array<string, float|int|string>  $values  nutrient id => amount
 * @return array<string, mixed>
 */
function nutritionEnvelope(array $values): array
{
    $units = ['energy' => 'kcal', 'sodium' => 'mg'];

    $amounts = [];

    foreach ($values as $nutrientId => $value) {
        $amounts[] = [
            'nutrient_id' => $nutrientId,
            'unit' => $units[$nutrientId] ?? 'g',
            'value' => $value,
        ];
    }

    return ['basis' => 'per_100g', 'amounts' => $amounts];
}

/**
 * A verified ingredient carrying facts, a default unit and — for the ones a
 * volume or a count has to be weighed through — a `grams_per_unit`.
 *
 * @param  array<string, mixed>|null  $envelope
 */
function nourishedIngredient(
    object $kitchen,
    string $name,
    ?array $envelope,
    string $defaultUnitCode = 'g',
    ?string $gramsPerUnit = null,
): Ingredient {
    $ingredient = RecipeWorld::verifiedCleanIngredient($kitchen->organisation, $name.' '.uniqid());
    $ingredient->nutrition_per_100g = $envelope;
    $ingredient->default_unit_id = RecipeWorld::unit($defaultUnitCode);
    $ingredient->grams_per_unit = $gramsPerUnit;
    $ingredient->save();

    return $ingredient->load('defaultUnit');
}

/**
 * @return array{ingredient: Ingredient, quantity: string|null, unit: MeasurementUnit|null}
 */
function nutritionLine(Ingredient $ingredient, ?string $quantity, ?string $unitCode = 'g'): array
{
    return [
        'ingredient' => $ingredient,
        'quantity' => $quantity,
        'unit' => $unitCode === null ? null : MeasurementUnit::query()->where('code', $unitCode)->sole(),
    ];
}

/**
 * An envelope's amounts flattened to `nutrient id => value`, which also asserts
 * the label order: `toBe()` on an array compares keys in order.
 *
 * @param  array<string, mixed>  $facts
 * @return array<string, float>
 */
function amountValues(array $facts): array
{
    $values = [];

    foreach ($facts['amounts'] as $amount) {
        $values[$amount['nutrient_id']] = $amount['value'];
    }

    return $values;
}

it('sums per-100 g facts across two mass lines', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $freekeh = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $result = $this->nutrition->derive([
        nutritionLine($tahini, '100'),
        nutritionLine($freekeh, '50'),
    ], null, null, $this->at);

    expect($result->isComplete())->toBeTrue()
        ->and($result->unresolved)->toBe([])
        ->and($result->massBasis)->toBe('input');

    $facts = $result->perRecipe();

    expect($facts['basis'])->toBe('per_recipe')
        ->and($facts['kind'])->toBe('planned')
        ->and($facts['serving'])->toBeNull()
        ->and($facts['total_grams'])->toBe(150.0)
        ->and($facts['source'])->toBe([
            'kind' => 'ingredient_derived',
            'label' => 'Derived from ingredient reference facts',
            'version' => '1',
            'calculated_at' => $this->at->toIso8601String(),
        ])
        ->and($facts['calculation'])->toBe([
            'method' => 'recipe.nutrition.from_ingredients',
            'basis' => 'per_recipe',
            'calculated_at' => $this->at->toIso8601String(),
            'prototype' => false,
            'rounding' => 'half_away_from_zero_3dp',
            'notes' => ['mass_basis: input'],
        ])
        ->and($facts['amounts'][0])->toBe([
            'nutrient_id' => 'energy',
            'unit' => 'kcal',
            'value' => 771.0,
            'kind' => 'planned',
            'tolerance' => null,
        ])
        ->and(amountValues($facts))->toBe([
            'energy' => 771.0,
            'protein' => 23.3,
            'carbohydrate' => 57.3,
            'fat' => 54.95,
            'fibre' => 15.85,
            'sugars' => 0.9,
            'sodium' => 118.0,
        ]);
});

it('converts a line stated in kilograms before scaling the facts', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));

    $inKilograms = $this->nutrition->derive([nutritionLine($tahini, '0.25', 'kg')], null, null, $this->at);
    $inGrams = $this->nutrition->derive([nutritionLine($tahini, '250')], null, null, $this->at);

    expect($inKilograms->perRecipe())->toBe($inGrams->perRecipe())
        ->and($inKilograms->perRecipe()['total_grams'])->toBe(250.0)
        ->and(amountValues($inKilograms->perRecipe())['energy'])->toBe(1487.5);
});

it('weighs a volume line through the ingredient grams per unit', function (): void {
    // Balsamic vinegar: a litre weighs 1080 g, which is the whole reason the
    // factor lives on the ingredient rather than in the conversion service.
    $vinegar = nourishedIngredient($this->kitchen, 'Balsamic', nutritionEnvelope(tahiniPer100g()), 'l', '1080');

    $inLitres = $this->nutrition->derive([nutritionLine($vinegar, '0.5', 'l')], null, null, $this->at);
    $inMillilitres = $this->nutrition->derive([nutritionLine($vinegar, '500', 'ml')], null, null, $this->at);

    expect($inLitres->perRecipe()['total_grams'])->toBe(540.0)
        ->and(amountValues($inLitres->perRecipe())['energy'])->toBe(3213.0)
        ->and($inMillilitres->perRecipe())->toBe($inLitres->perRecipe());
});

it('adds two lines that name the same ingredient', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));

    $result = $this->nutrition->derive([
        nutritionLine($tahini, '100'),
        nutritionLine($tahini, '100'),
    ], null, null, $this->at);

    expect($result->perRecipe()['total_grams'])->toBe(200.0)
        ->and(amountValues($result->perRecipe())['energy'])->toBe(1190.0);
});

it('divides the exact totals for a serving and for a hundred grams', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $freekeh = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $result = $this->nutrition->derive([
        nutritionLine($tahini, '100'),
        nutritionLine($freekeh, '50'),
    ], null, null, $this->at);

    $perServing = $result->perServing('4');
    $perHundred = $result->per100g();

    expect($perServing['basis'])->toBe('per_serving')
        ->and($perServing['calculation']['method'])->toBe('recipe.nutrition.per_serving')
        ->and($perServing['total_grams'])->toBe(37.5)
        ->and(amountValues($perServing))->toBe([
            'energy' => 192.75,
            'protein' => 5.825,
            'carbohydrate' => 14.325,
            // 54.95 ÷ 4 is 13.7375 exactly, and half away from zero at three
            // places is 13.738 — a truncating bcmath would have said 13.737.
            'fat' => 13.738,
            'fibre' => 3.963,
            'sugars' => 0.225,
            'sodium' => 29.5,
        ]);

    expect($perHundred['basis'])->toBe('per_100g')
        ->and($perHundred['calculation']['method'])->toBe('recipe.nutrition.per_100g')
        ->and($perHundred['total_grams'])->toBe(100.0)
        ->and(amountValues($perHundred))->toBe([
            'energy' => 514.0,
            'protein' => 15.533,
            'carbohydrate' => 38.2,
            'fat' => 36.633,
            'fibre' => 10.567,
            'sugars' => 0.6,
            'sodium' => 78.667,
        ]);
});

it('divides per-100 g by a stated mass yield rather than by the input mass', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $freekeh = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $lines = [nutritionLine($tahini, '100'), nutritionLine($freekeh, '50')];

    $onInput = $this->nutrition->derive($lines, null, null, $this->at);
    $onYield = $this->nutrition->derive($lines, '120', MeasurementUnit::query()->where('code', 'g')->sole(), $this->at);

    expect($onYield->massBasis)->toBe('yield')
        // The amounts are the dish's, whatever it weighs when it comes out.
        ->and(amountValues($onYield->perRecipe()))->toBe(amountValues($onInput->perRecipe()))
        ->and($onYield->perRecipe()['total_grams'])->toBe(120.0)
        ->and($onYield->perRecipe()['calculation']['notes'])->toBe(['mass_basis: yield'])
        ->and($onInput->perRecipe()['calculation']['notes'])->toBe(['mass_basis: input'])
        // 771 × 100 ÷ 120.
        ->and(amountValues($onYield->per100g())['energy'])->toBe(642.5)
        ->and(amountValues($onInput->per100g())['energy'])->toBe(514.0);
});

it('falls back to the input mass when the yield is stated in pieces', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));

    $result = $this->nutrition->derive(
        [nutritionLine($tahini, '150')],
        '4',
        MeasurementUnit::query()->where('code', 'piece')->sole(),
        $this->at,
    );

    expect($result->massBasis)->toBe('input')
        ->and($result->perRecipe()['total_grams'])->toBe(150.0)
        ->and($result->perRecipe()['calculation']['notes'])->toBe(['mass_basis: input']);
});

it('withholds a per-serving figure when nobody stated the servings', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));

    $result = $this->nutrition->derive([nutritionLine($tahini, '100')], null, null, $this->at);

    expect($result->perServing(null))->toBeNull()
        ->and($result->perServing('0'))->toBeNull()
        ->and($result->perServing('-2'))->toBeNull()
        ->and($result->perServing('four'))->toBeNull()
        ->and($result->perServing('2'))->not->toBeNull();
});

it('withholds every figure and names the ingredient missing a required nutrient', function (): void {
    $values = tahiniPer100g();
    unset($values['sodium']);

    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $incomplete = nourishedIngredient($this->kitchen, 'Sodium-less', nutritionEnvelope($values));

    $result = $this->nutrition->derive([
        nutritionLine($tahini, '100'),
        nutritionLine($incomplete, '50'),
    ], null, null, $this->at);

    expect($result->isComplete())->toBeFalse()
        ->and($result->perRecipe())->toBeNull()
        ->and($result->perServing('4'))->toBeNull()
        ->and($result->per100g())->toBeNull()
        ->and($result->snapshotJson())->toBeNull()
        ->and($result->ingredientIdsFor('missing_nutrition'))->toBe([(string) $incomplete->getKey()])
        ->and($result->ingredientIdsFor('unconvertible_unit'))->toBe([]);
});

it('refuses an ingredient whose facts cannot be trusted', function (?array $envelope): void {
    $ingredient = nourishedIngredient($this->kitchen, 'Suspect', $envelope);

    $result = $this->nutrition->derive([nutritionLine($ingredient, '100')], null, null, $this->at);

    expect($result->isComplete())->toBeFalse()
        ->and($result->perRecipe())->toBeNull()
        ->and($result->ingredientIdsFor('missing_nutrition'))->toBe([(string) $ingredient->getKey()]);
})->with([
    'no facts at all' => fn (): ?array => null,
    'a basis other than per_100g' => fn (): array => [
        'basis' => 'per_serving',
        'amounts' => nutritionEnvelope(tahiniPer100g())['amounts'],
    ],
    'a duplicate nutrient id' => fn (): array => [
        'basis' => 'per_100g',
        'amounts' => [
            ...nutritionEnvelope(tahiniPer100g())['amounts'],
            ['nutrient_id' => 'protein', 'unit' => 'g', 'value' => 4],
        ],
    ],
    'energy in kilojoules' => fn (): array => [
        'basis' => 'per_100g',
        'amounts' => array_map(
            static fn (array $amount): array => $amount['nutrient_id'] === 'energy'
                ? ['nutrient_id' => 'energy', 'unit' => 'kJ', 'value' => 2489]
                : $amount,
            nutritionEnvelope(tahiniPer100g())['amounts'],
        ),
    ],
    'an unknown nutrient id' => fn (): array => [
        'basis' => 'per_100g',
        'amounts' => [
            ...nutritionEnvelope(tahiniPer100g())['amounts'],
            ['nutrient_id' => 'caffeine', 'unit' => 'mg', 'value' => 12],
        ],
    ],
    'a negative amount' => fn (): array => nutritionEnvelope(['protein' => -1] + tahiniPer100g()),
]);

it('refuses a line it cannot weigh, without guessing a density', function (): void {
    $facts = nutritionEnvelope(tahiniPer100g());

    $unweighed = nourishedIngredient($this->kitchen, 'Unweighed pieces', $facts, 'piece');
    $counted = nourishedIngredient($this->kitchen, 'Counted pieces', $facts, 'piece', '30');
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', $facts);

    // A piece line on an ingredient nobody has weighed; a volume line whose
    // ingredient is measured in pieces, which the conversion service refuses
    // outright; and a line with no quantity at all.
    $result = $this->nutrition->derive([
        nutritionLine($unweighed, '2', 'piece'),
        nutritionLine($counted, '0.5', 'l'),
        nutritionLine($tahini, null, null),
    ], null, null, $this->at);

    expect($result->isComplete())->toBeFalse()
        ->and($result->perRecipe())->toBeNull()
        ->and($result->ingredientIdsFor('unconvertible_unit'))->toBe([
            (string) $unweighed->getKey(),
            (string) $counted->getKey(),
            (string) $tahini->getKey(),
        ])
        ->and($result->ingredientIdsFor('missing_nutrition'))->toBe([]);

    // The same counted ingredient on a piece line converts, because its
    // grams_per_unit is the mass of one piece: 2 × 30 g.
    $weighed = $this->nutrition->derive([nutritionLine($counted, '2', 'piece')], null, null, $this->at);

    expect($weighed->isComplete())->toBeTrue()
        ->and($weighed->perRecipe()['total_grams'])->toBe(60.0);
});

it('carries saturated fat only when every contributing line states it', function (): void {
    $withSaturates = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g() + ['saturated_fat' => 7.5]));
    $alsoWithSaturates = nourishedIngredient($this->kitchen, 'Butter', nutritionEnvelope(tahiniPer100g() + ['saturated_fat' => 50]));
    $without = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $both = $this->nutrition->derive([
        nutritionLine($withSaturates, '100'),
        nutritionLine($alsoWithSaturates, '100'),
    ], null, null, $this->at);

    $mixed = $this->nutrition->derive([
        nutritionLine($withSaturates, '100'),
        nutritionLine($without, '100'),
    ], null, null, $this->at);

    expect(array_keys(amountValues($both->perRecipe())))->toBe([
        'energy', 'protein', 'carbohydrate', 'fat', 'fibre', 'sugars', 'saturated_fat', 'sodium',
    ])
        ->and(amountValues($both->perRecipe())['saturated_fat'])->toBe(57.5)
        // Not 7.5, and not 7.5 plus an invented zero: omitted entirely.
        ->and(amountValues($mixed->perRecipe()))->not->toHaveKey('saturated_fat')
        ->and($mixed->isComplete())->toBeTrue();
});

it('rounds once, half away from zero, at the scale the caller asks for', function (): void {
    $ingredient = nourishedIngredient($this->kitchen, 'Trace', nutritionEnvelope([
        'energy' => 1.234567,
        // Lands exactly on a half at three places: 1.0005 → 1.001, never 1.000.
        'protein' => 1.0005,
        'carbohydrate' => 0,
        'fat' => 0,
        'fibre' => 0,
        'sugars' => 0,
        'sodium' => 0,
    ]));

    $result = $this->nutrition->derive([nutritionLine($ingredient, '100')], null, null, $this->at);

    expect(amountValues($result->perRecipe()))->toBe([
        'energy' => 1.235,
        'protein' => 1.001,
        'carbohydrate' => 0.0,
        'fat' => 0.0,
        'fibre' => 0.0,
        'sugars' => 0.0,
        'sodium' => 0.0,
    ])
        ->and($result->perRecipe()['calculation']['rounding'])->toBe('half_away_from_zero_3dp')
        ->and(amountValues($result->perRecipe(6)))->toBe([
            'energy' => 1.234567,
            'protein' => 1.0005,
            'carbohydrate' => 0.0,
            'fat' => 0.0,
            'fibre' => 0.0,
            'sugars' => 0.0,
            'sodium' => 0.0,
        ])
        ->and($result->perRecipe(6)['calculation']['rounding'])->toBe('half_away_from_zero_6dp');
});

it('reconciles three servings with the whole recipe', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $freekeh = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $result = $this->nutrition->derive([
        nutritionLine($tahini, '100'),
        nutritionLine($freekeh, '50'),
    ], null, null, $this->at);

    $perRecipe = amountValues($result->perRecipe());
    $perServing = amountValues($result->perServing('3'));

    // A third of a recipe is not exactly reversible, and each serving may be
    // off by half of the last place it was rounded to, so three of them may be
    // off by three halves. 0.001 would be asserting a coincidence.
    foreach ($perRecipe as $nutrientId => $value) {
        expect($perServing[$nutrientId] * 3)->toEqualWithDelta($value, 0.0015);
    }
});

it('encodes a six-place snapshot for the version write', function (): void {
    $ingredient = nourishedIngredient($this->kitchen, 'Trace', nutritionEnvelope([
        'energy' => 1.234567,
        'protein' => 1.0005,
        'carbohydrate' => 0,
        'fat' => 0,
        'fibre' => 0,
        'sugars' => 0,
        'sodium' => 0,
    ]));

    $result = $this->nutrition->derive([nutritionLine($ingredient, '100')], null, null, $this->at);

    $decoded = json_decode((string) $result->snapshotJson(), true);

    expect($decoded['basis'])->toBe('per_recipe')
        ->and($decoded['calculation']['rounding'])->toBe('half_away_from_zero_6dp')
        ->and($decoded['source']['kind'])->toBe('ingredient_derived')
        // `toEqual`, not `toBe`: JSON has one number type, so a whole float
        // round-trips back as an int. jsonb does the same thing to the column.
        ->and($decoded['total_grams'])->toEqual(100.0)
        // Six places, not the three a transport payload would have carried.
        ->and(amountValues($decoded)['energy'])->toBe(1.234567);
});

it('rescales a stored envelope without restating where it came from', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $freekeh = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $stored = $this->nutrition->derive([
        nutritionLine($tahini, '100'),
        nutritionLine($freekeh, '50'),
    ], null, null, $this->at)->perRecipe(RecipeNutritionService::SNAPSHOT_SCALE);

    $serving = ['label' => '', 'quantity' => 1, 'unit' => 'portion', 'grams' => 75.0, 'millilitres' => null, 'household_measure' => null];

    $scaled = $this->nutrition->scale($stored, '0.5', 'per_serving', 'catalogue.nutrition.per_sold_unit', $serving, 3);

    expect($scaled['basis'])->toBe('per_serving')
        ->and($scaled['serving'])->toBe($serving)
        ->and($scaled['total_grams'])->toBe(75.0)
        ->and($scaled['calculation']['method'])->toBe('catalogue.nutrition.per_sold_unit')
        ->and($scaled['calculation']['basis'])->toBe('per_serving')
        ->and($scaled['calculation']['rounding'])->toBe('half_away_from_zero_3dp')
        // Provenance and the mass basis survive: scaling a figure does not
        // change where it came from or what it was computed over.
        ->and($scaled['source'])->toBe($stored['source'])
        ->and($scaled['calculation']['notes'])->toBe(['mass_basis: input'])
        ->and($scaled['calculation']['calculated_at'])->toBe($this->at->toIso8601String())
        ->and(amountValues($scaled))->toBe([
            'energy' => 385.5,
            'protein' => 11.65,
            'carbohydrate' => 28.65,
            'fat' => 27.475,
            'fibre' => 7.925,
            'sugars' => 0.45,
            'sodium' => 59.0,
        ]);
});

it('rolls a saved version up from its own lines and yield', function (): void {
    $tahini = nourishedIngredient($this->kitchen, 'Tahini', nutritionEnvelope(tahiniPer100g()));
    $freekeh = nourishedIngredient($this->kitchen, 'Freekeh', nutritionEnvelope(freekehPer100g()));

    $recipe = Recipe::factory()->create(['organisation_id' => $this->kitchen->organisation->getKey()]);

    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'yield_quantity' => '0.12',
        'yield_unit_id' => RecipeWorld::unit('kg'),
    ]);

    foreach ([[$tahini, '100', 'g'], [$freekeh, '0.05', 'kg']] as $index => [$ingredient, $quantity, $unitCode]) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $this->kitchen->organisation->getKey(),
            'ingredient_id' => $ingredient->getKey(),
            'line_number' => $index + 1,
            'quantity' => $quantity,
            'unit_id' => RecipeWorld::unit($unitCode),
        ]);
    }

    $lines = RecipeVersionLine::withoutTenancy()
        ->where('recipe_version_id', $version->getKey())
        ->orderBy('line_number')
        ->get();

    $result = $this->nutrition->forVersion($version->refresh(), $lines);

    expect($result->isComplete())->toBeTrue()
        ->and($result->massBasis)->toBe('yield')
        ->and($result->perRecipe()['total_grams'])->toBe(120.0)
        ->and(amountValues($result->perRecipe()))->toBe([
            'energy' => 771.0,
            'protein' => 23.3,
            'carbohydrate' => 57.3,
            'fat' => 54.95,
            'fibre' => 15.85,
            'sugars' => 0.9,
            'sodium' => 118.0,
        ]);
});
