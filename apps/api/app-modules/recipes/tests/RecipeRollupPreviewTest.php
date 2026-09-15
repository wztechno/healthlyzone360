<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Roll-up preview for unsaved recipe drafts
|--------------------------------------------------------------------------
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('rollup@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * The seven canonical figures for tahini, per 100 g.
 *
 * Prefixed, because Pest loads every file in the suite into one process and
 * `RecipeNutritionServiceTest` declares its own — the same redeclaration
 * hazard `RecipeWorld`'s docblock exists to explain.
 *
 * @return array<string, float|int>
 */
function rollupTahiniPer100g(): array
{
    return ['energy' => 595, 'protein' => 17, 'carbohydrate' => 21.2, 'fat' => 53.8, 'fibre' => 9.3, 'sugars' => 0.5, 'sodium' => 115];
}

/**
 * @return array<string, float|int>
 */
function rollupFreekehPer100g(): array
{
    return ['energy' => 352, 'protein' => 12.6, 'carbohydrate' => 72.2, 'fat' => 2.3, 'fibre' => 13.1, 'sugars' => 0.8, 'sodium' => 6];
}

/**
 * An envelope's amounts flattened to `nutrient id => value`, which also asserts
 * the label order: comparing arrays compares keys in order.
 *
 * @param  array<string, mixed>  $facts
 * @return array<string, float|int>
 */
function rollupAmountValues(array $facts): array
{
    $values = [];

    foreach ($facts['amounts'] as $amount) {
        $values[$amount['nutrient_id']] = $amount['value'];
    }

    return $values;
}

/*
|--------------------------------------------------------------------------
| The nutrition figures
|--------------------------------------------------------------------------
|
| The claim: the preview answers with real numbers, and withholds all three of
| them the moment one line cannot be finished — naming the ingredient rather
| than quietly leaving it out of the sum.
|
| Literal amounts throughout, with inputs chosen so the arithmetic is exact
| (100 g of a 595 kcal ingredient is 595 kcal). That is what lets a wrong answer
| be a failed assertion rather than a tolerance somebody widens.
|
*/

it('computes the nutrition figures for a draft and rolls up its allergens', function (): void {
    $sesame = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
    );
    $gluten = RecipeWorld::nourish(
        RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Freekeh', 'gluten'),
        RecipeWorld::nutritionEnvelope(rollupFreekehPer100g()),
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 4,
        'lines' => [
            ['ingredient_id' => $sesame->getKey(), 'quantity' => '100', 'unit_id' => $this->grams],
            ['ingredient_id' => $gluten->getKey(), 'quantity' => '50', 'unit_id' => $this->grams],
        ],
    ], $this->headers)->assertOk();

    $codes = collect($response->json('data.allergen_sources'))->pluck('allergen_code')->all();

    expect($codes)->toEqualCanonicalizing(['sesame', 'gluten']);

    $perRecipe = $response->json('data.per_recipe');

    expect($perRecipe['basis'])->toBe('per_recipe')
        ->and($perRecipe['source']['kind'])->toBe('ingredient_derived')
        ->and($perRecipe['total_grams'])->toEqual(150)
        ->and(rollupAmountValues($perRecipe))->toEqual([
            'energy' => 771,
            'protein' => 23.3,
            'carbohydrate' => 57.3,
            'fat' => 54.95,
            'fibre' => 15.85,
            'sugars' => 0.9,
            'sodium' => 118,
        ]);

    // Four servings of it, dividing the *exact* sum rather than the rounded
    // one: 54.95 ÷ 4 is 13.7375, and half away from zero is 13.738.
    $perServing = $response->json('data.per_serving');

    expect($perServing['basis'])->toBe('per_serving')
        ->and($perServing['total_grams'])->toEqual(37.5)
        ->and(rollupAmountValues($perServing))->toEqual([
            'energy' => 192.75,
            'protein' => 5.825,
            'carbohydrate' => 14.325,
            'fat' => 13.738,
            'fibre' => 3.963,
            'sugars' => 0.225,
            'sodium' => 29.5,
        ]);

    // No yield was stated, so the comparison basis is the 150 g that went in,
    // and the envelope says so rather than leaving a reader to infer it.
    $perHundred = $response->json('data.per_100g');

    expect($perHundred['basis'])->toBe('per_100g')
        ->and($perHundred['total_grams'])->toEqual(100)
        ->and($perHundred['calculation']['notes'])->toContain('mass_basis: input')
        ->and(rollupAmountValues($perHundred))->toEqual([
            'energy' => 514,
            'protein' => 15.533,
            'carbohydrate' => 38.2,
            'fat' => 36.633,
            'fibre' => 10.567,
            'sugars' => 0.6,
            'sodium' => 78.667,
        ]);

    expect(collect($response->json('data.warnings'))->pluck('code'))
        ->not->toContain('nutrition_unavailable');
});

it('converts a line stated in kilograms before scaling the facts', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Tahini'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [
            ['ingredient_id' => $tahini->getKey(), 'quantity' => '0.25', 'unit_id' => RecipeWorld::unit('kg')],
        ],
    ], $this->headers)->assertOk();

    expect($response->json('data.per_recipe.total_grams'))->toEqual(250)
        ->and(rollupAmountValues($response->json('data.per_recipe'))['energy'])->toEqual(1487.5);
});

it('weighs a millilitre line through the ingredient grams per unit', function (): void {
    /*
     * Balsamic vinegar: a litre weighs 1080 g, which is the whole reason the
     * factor lives on the ingredient rather than in the conversion service.
     * The line is in millilitres and the factor is per *litre*, so the line has
     * to reach the ingredient's own unit before the multiplication — 500 ml is
     * 0.5 l is 540 g.
     */
    $vinegar = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Balsamic'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
        'l',
        '1080',
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [
            ['ingredient_id' => $vinegar->getKey(), 'quantity' => '500', 'unit_id' => RecipeWorld::unit('ml')],
        ],
    ], $this->headers)->assertOk();

    expect($response->json('data.per_recipe.total_grams'))->toEqual(540)
        ->and(rollupAmountValues($response->json('data.per_recipe'))['energy'])->toEqual(3213);
});

it('withholds every figure and names the ingredient with no reference facts', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Tahini'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
    );
    $blank = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Sumac'),
        null,
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 4,
        'lines' => [
            ['ingredient_id' => $tahini->getKey(), 'quantity' => '100', 'unit_id' => $this->grams],
            ['ingredient_id' => $blank->getKey(), 'quantity' => '50', 'unit_id' => $this->grams],
        ],
    ], $this->headers)->assertOk();

    $warning = collect($response->json('data.warnings'))->firstWhere('code', 'rollup.missing_nutrition');

    // Not "595 kcal and whatever sumac has": a total short by exactly the
    // ingredient nobody recorded reads identically to a correct one.
    expect($response->json('data.per_recipe'))->toBeNull()
        ->and($response->json('data.per_serving'))->toBeNull()
        ->and($response->json('data.per_100g'))->toBeNull()
        ->and($warning)->not->toBeNull()
        ->and($warning['ingredient_ids'])->toBe([(string) $blank->getKey()]);
});

it('withholds every figure and names the line it cannot weigh', function (): void {
    // A piece line on an ingredient nobody has weighed. The facts are perfect;
    // there is simply no answer to "what do two of them weigh".
    $unweighed = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Flatbread'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
        'piece',
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 2,
        'lines' => [
            ['ingredient_id' => $unweighed->getKey(), 'quantity' => '2', 'unit_id' => RecipeWorld::unit('piece')],
        ],
    ], $this->headers)->assertOk();

    $warning = collect($response->json('data.warnings'))->firstWhere('code', 'rollup.unconvertible_unit');

    expect($response->json('data.per_recipe'))->toBeNull()
        ->and($response->json('data.per_serving'))->toBeNull()
        ->and($response->json('data.per_100g'))->toBeNull()
        ->and($warning)->not->toBeNull()
        ->and($warning['ingredient_ids'])->toBe([(string) $unweighed->getKey()]);
});

it('divides per-100 g by a stated mass yield rather than by the input mass', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Tahini'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
    );
    $freekeh = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Freekeh'),
        RecipeWorld::nutritionEnvelope(rollupFreekehPer100g()),
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 4,
        'yield_quantity' => '0.12',
        'yield_unit_id' => RecipeWorld::unit('kg'),
        'lines' => [
            ['ingredient_id' => $tahini->getKey(), 'quantity' => '100', 'unit_id' => $this->grams],
            ['ingredient_id' => $freekeh->getKey(), 'quantity' => '50', 'unit_id' => $this->grams],
        ],
    ], $this->headers)->assertOk();

    // The dish contains what went into it whatever it weighs coming out, so the
    // amounts are untouched; only what they are *compared against* moves.
    expect(rollupAmountValues($response->json('data.per_recipe')))->toEqual([
        'energy' => 771,
        'protein' => 23.3,
        'carbohydrate' => 57.3,
        'fat' => 54.95,
        'fibre' => 15.85,
        'sugars' => 0.9,
        'sodium' => 118,
    ])
        ->and($response->json('data.per_recipe.total_grams'))->toEqual(120)
        ->and($response->json('data.per_recipe.calculation.notes'))->toContain('mass_basis: yield')
        // 771 × 100 ÷ 120, where the input basis would have said 514.
        ->and(rollupAmountValues($response->json('data.per_100g'))['energy'])->toEqual(642.5);
});

it('withholds only the per-serving figure when the draft never stated its servings', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Tahini'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
    );

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'lines' => [
            ['ingredient_id' => $tahini->getKey(), 'quantity' => '100', 'unit_id' => $this->grams],
        ],
    ], $this->headers)->assertOk();

    // Nothing here knows how a batch is portioned unless a human says so, and a
    // default of one would label a twelve-portion batch as a single serving.
    expect($response->json('data.per_serving'))->toBeNull()
        ->and($response->json('data.per_recipe.total_grams'))->toEqual(100)
        ->and($response->json('data.per_100g.total_grams'))->toEqual(100);
});

it('refuses a servings count of zero rather than reading it as unstated', function (): void {
    $tahini = RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Tahini'),
        RecipeWorld::nutritionEnvelope(rollupTahiniPer100g()),
    );

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 0,
        'lines' => [
            ['ingredient_id' => $tahini->getKey(), 'quantity' => '100', 'unit_id' => $this->grams],
        ],
    ], $this->headers)->assertStatus(422);
});

it('sums line costs with waste and refuses mixed currencies as a warning', function (): void {
    $ingredient = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Chicken');

    $priced = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 2,
        'waste_percent' => 10,
        'lines' => [
            [
                'ingredient_id' => $ingredient->getKey(),
                'quantity' => '2',
                'unit_cost_amount' => '5.00',
                'cost_currency_code' => 'USD',
            ],
            [
                'ingredient_id' => $ingredient->getKey(),
                'quantity' => '1',
                'unit_cost_amount' => '3.00',
                'cost_currency_code' => 'USD',
            ],
        ],
    ], $this->headers)->assertOk();

    expect($priced->json('data.estimated_cost.amount'))->toBe('14.300000')
        ->and($priced->json('data.estimated_cost.currency'))->toBe('USD');

    $mixed = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [
            [
                'ingredient_id' => $ingredient->getKey(),
                'quantity' => '1',
                'unit_cost_amount' => '5.00',
                'cost_currency_code' => 'USD',
            ],
            [
                'ingredient_id' => $ingredient->getKey(),
                'quantity' => '1',
                'unit_cost_amount' => '4.00',
                'cost_currency_code' => 'EUR',
            ],
        ],
    ], $this->headers)->assertOk();

    expect($mixed->json('data.estimated_cost'))->toBeNull()
        ->and(collect($mixed->json('data.warnings'))->pluck('code'))->toContain('rollup.mixed_cost_currency');
});

it('hides estimated cost without recipe.view_costs_organisation', function (): void {
    $viewer = RecipeWorld::kitchen('rollup-viewer@recipes.test', [
        'recipe.view_organisation',
    ]);
    $ingredient = RecipeWorld::verifiedCleanIngredient($viewer->organisation, 'Rice');

    $this->actingAs($viewer->user);

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [
            [
                'ingredient_id' => $ingredient->getKey(),
                'quantity' => '1',
                'unit_cost_amount' => '5.00',
                'cost_currency_code' => 'USD',
            ],
        ],
    ], RecipeWorld::headers($viewer))
        ->assertOk()
        ->assertJsonPath('data.estimated_cost', null);
});

it('allows recipe.manage_organisation without the view permission', function (): void {
    $editor = RecipeWorld::kitchen('rollup-editor@recipes.test', [
        'recipe.manage_organisation',
    ]);
    $ingredient = RecipeWorld::verifiedCleanIngredient($editor->organisation, 'Lentils');

    $this->actingAs($editor->user);

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [
            ['ingredient_id' => $ingredient->getKey(), 'quantity' => '1', 'unit_id' => RecipeWorld::unit()],
        ],
    ], RecipeWorld::headers($editor))->assertOk();
});

it('refuses callers without recipe view or manage permissions', function (): void {
    $outsider = RecipeWorld::kitchen('rollup-outsider@recipes.test', [
        'catalogue.view_organisation',
    ]);

    $this->actingAs($outsider->user);

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [],
    ], RecipeWorld::headers($outsider))->assertForbidden();
});

/*
|--------------------------------------------------------------------------
| The cost block over an unsaved draft
|--------------------------------------------------------------------------
|
| The point of these: a kitchen filling in the create form can see what the
| recipe will cost *before* saving it. The step that exists to answer "what
| does this cost" used to answer "save it and come back", which is the one
| moment the figure is not useful — a person choosing between two bottle sizes
| needs it while they are choosing.
|
*/

it('reproduces the workbook cost block for a recipe that does not exist yet', function (): void {
    /*
     * The source sheet, digit for digit, through the preview endpoint and with
     * nothing persisted. `RecipePackagingCostTest` asserts the same figures
     * over a *saved* version; this asserts the draft path lands on them too,
     * which is the whole claim — one arithmetic, two entry points.
     *
     * Yield 1.7 kg, formulation totalling 7.186, 3% process waste and 5%
     * packaging waste. A bottle holding the whole batch and a cap that goes one
     * per bottle, both at the workbook's prices.
     */
    $kilograms = RecipeWorld::unit('kg');
    $ingredient = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Mayonnaise');
    $bottle = RecipeWorld::packagingItem($this->kitchen->organisation, 'Bottle 300', '0.25', '1.7');
    $cap = RecipeWorld::packagingItem($this->kitchen->organisation, 'Cap', '0.10');

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'waste_percent' => 3,
        'packaging_waste_percent' => 5,
        'yield_quantity' => '1.7',
        'yield_unit_id' => $kilograms,
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '1',
            'unit_id' => $kilograms,
            'unit_cost_amount' => '7.186',
            'cost_currency_code' => 'USD',
        ]],
        'packaging' => [
            ['ingredient_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield'],
            ['ingredient_id' => (string) $cap->getKey(), 'basis' => 'per_container'],
        ],
    ], $this->headers)->assertOk();

    $computed = $response->json('data.computed_cost');

    expect($computed['currency_code'])->toBe('USD')
        // E23, B25-B27: the line total, over the yield, with 3% on it.
        ->and($computed['production']['total_input_cost_amount'])->toBe('7.186000')
        ->and($computed['production']['cost_per_yield_unit_amount'])->toBe('4.227059')
        ->and($computed['production']['cost_per_yield_unit_with_waste_amount'])->toBe('4.353871')
        ->and($computed['production']['is_complete'])->toBeTrue()
        // E33, B35-B37: the same three steps over the packaging, divided by the
        // *same* yield - which is what makes the two halves addable at the end.
        ->and($computed['packaging']['total_packaging_cost_amount'])->toBe('0.350000')
        ->and($computed['packaging']['cost_per_yield_unit_amount'])->toBe('0.205882')
        ->and($computed['packaging']['cost_per_yield_unit_with_waste_amount'])->toBe('0.216176')
        ->and($computed['packaging']['is_complete'])->toBeTrue()
        // B39, the sheet's bottom line.
        ->and($computed['total_cost_per_yield_unit_amount'])->toBe('4.570047')
        ->and($computed['yield_unit_id'])->toBe($kilograms);
});

it('withholds the total while a packaging item carries no price', function (): void {
    /*
     * Reported rather than under-reported, and both halves still served. A
     * total short by whatever nobody has priced reads exactly like a complete
     * one; "we cannot total this, and line 1 is why" is something somebody can
     * act on this afternoon.
     */
    $kilograms = RecipeWorld::unit('kg');
    $ingredient = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Mayonnaise');
    $unpriced = RecipeWorld::packagingItem($this->kitchen->organisation, 'Unpriced tub', '0.25', '1.7');
    $unpriced->purchase_price_amount = null;
    $unpriced->purchase_price_currency = null;
    $unpriced->save();

    $computed = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'yield_quantity' => '1.7',
        'yield_unit_id' => $kilograms,
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '1',
            'unit_id' => $kilograms,
            'unit_cost_amount' => '7.186',
            'cost_currency_code' => 'USD',
        ]],
        'packaging' => [
            ['ingredient_id' => (string) $unpriced->getKey(), 'basis' => 'fills_yield'],
        ],
    ], $this->headers)->assertOk()->json('data.computed_cost');

    expect($computed['production']['cost_per_yield_unit_amount'])->toBe('4.227059')
        ->and($computed['packaging']['uncosted_line_numbers'])->toBe([1])
        ->and($computed['packaging']['is_complete'])->toBeFalse()
        ->and($computed['total_cost_per_yield_unit_amount'])->toBeNull();
});

it('omits the cost block when the draft states no yield', function (): void {
    /*
     * Every figure below the two line totals is *something over the yield*, so
     * without one there is no block to show - only two totals, which
     * `estimated_cost` already carries. Serving a block of nulls under headings
     * that promise per-kilo figures would be worse than serving nothing.
     */
    $ingredient = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Mayonnaise');

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '1',
            'unit_id' => RecipeWorld::unit(),
            'unit_cost_amount' => '7.186',
            'cost_currency_code' => 'USD',
        ]],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.computed_cost', null);
});

it('keeps the cost block behind the cost permission', function (): void {
    /*
     * The same gate `estimated_cost` sits behind. A line cook needs the method
     * and the allergen label to make the dish and must not thereby read the
     * margin on it.
     */
    $viewer = RecipeWorld::kitchen('rollup-costless-block@recipes.test', [
        'recipe.view_organisation',
    ]);
    $ingredient = RecipeWorld::verifiedCleanIngredient($viewer->organisation, 'Mayonnaise');

    $this->actingAs($viewer->user);

    $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 1,
        'yield_quantity' => '1.7',
        'yield_unit_id' => RecipeWorld::unit('kg'),
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => '1',
            'unit_id' => RecipeWorld::unit('kg'),
            'unit_cost_amount' => '7.186',
            'cost_currency_code' => 'USD',
        ]],
    ], RecipeWorld::headers($viewer))
        ->assertOk()
        ->assertJsonPath('data.computed_cost', null);
});
