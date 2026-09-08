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

it('rolls up allergens and warns that nutrition is unavailable', function (): void {
    $sesame = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $gluten = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Freekeh', 'gluten');

    $response = $this->postJson('/api/v1/catalogue/recipes/roll-up-preview', [
        'recipe_id' => null,
        'servings' => 4,
        'lines' => [
            ['ingredient_id' => $sesame->getKey(), 'quantity' => '100', 'unit_id' => $this->grams],
            ['ingredient_id' => $gluten->getKey(), 'quantity' => '50', 'unit_id' => $this->grams],
        ],
    ], $this->headers)->assertOk();

    $codes = collect($response->json('data.allergen_sources'))->pluck('allergen_code')->all();

    expect($codes)->toEqualCanonicalizing(['sesame', 'gluten'])
        ->and($response->json('data.per_recipe'))->toBeNull()
        ->and($response->json('data.per_serving'))->toBeNull()
        ->and($response->json('data.per_100g'))->toBeNull()
        ->and(collect($response->json('data.warnings'))->pluck('code'))->toContain('nutrition_unavailable');
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
            ['packaging_item_id' => (string) $bottle->getKey(), 'basis' => 'fills_yield'],
            ['packaging_item_id' => (string) $cap->getKey(), 'basis' => 'per_container'],
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
            ['packaging_item_id' => (string) $unpriced->getKey(), 'basis' => 'fills_yield'],
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
