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
