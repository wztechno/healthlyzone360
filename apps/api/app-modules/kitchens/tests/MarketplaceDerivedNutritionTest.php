<?php

declare(strict_types=1);

use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Kitchens\Presenters\MarketplaceMealPresenter;
use Healthy360\Kitchens\Services\MarketplaceChannels;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Derived nutrition on the public projection — B5 wiring
|--------------------------------------------------------------------------
|
| `MarketplaceReadTest` pins the other branch end to end: the demonstration
| menu records its own facts, and those reach the wire untouched. What this
| file pins is the branch that has no recorded facts — the listing whose
| figures are derived from its published recipe version — and the one place
| it could be lost, which is the presenter.
|
| The presenter used to read `catalogue_items.nutrition_facts` itself and take
| `serving` out of it. Both now come from one decision made upstream, and
| `serving` in particular has to follow it: a `serving` still read off the
| column beside a derived `nutrition` would describe a different portion from
| the amounts printed under it.
|
| Service level, not HTTP: a priced, published, channel-listed meal needs the
| demonstration world, and seeding it a second time to prove an argument is
| passed would cost more than it pins.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class]);
});

it('projects the derived per-serving facts and the serving they apply to', function (): void {
    $organisation = RecipeWorld::organisation();
    $recipe = Recipe::factory()->create(['organisation_id' => $organisation->getKey()]);

    // A snapshot in the shape `RecipeVersionService::publish()` writes — 400 g
    // of a 200 kcal/100 g formulation. Written by factory here rather than
    // published for real: that the snapshot is genuine is `DerivedNutritionTest`'s
    // claim, and this file's is only that it reaches the projection.
    RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisation->getKey(),
        'yield_piece_count' => 4,
        'nutrition_facts' => [
            'basis' => 'per_recipe',
            'kind' => 'planned',
            'serving' => null,
            'total_grams' => 400,
            'amounts' => [
                ['nutrient_id' => 'energy', 'unit' => 'kcal', 'value' => 800, 'kind' => 'planned', 'tolerance' => null],
                ['nutrient_id' => 'protein', 'unit' => 'g', 'value' => 40, 'kind' => 'planned', 'tolerance' => null],
            ],
            'source' => ['kind' => 'ingredient_derived', 'label' => 'Derived from ingredient reference facts', 'version' => '1', 'calculated_at' => '2026-09-13T00:00:00+00:00'],
            'calculation' => ['method' => 'recipe.nutrition.from_ingredients', 'basis' => 'per_recipe', 'calculated_at' => '2026-09-13T00:00:00+00:00', 'prototype' => false, 'rounding' => 'half_away_from_zero_6dp', 'notes' => ['mass_basis: input']],
        ],
    ]);

    $catalogue = Catalogue::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'default',
    ]);

    $created = CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    $meal = CatalogueItem::withoutTenancy()->whereKey($created->getKey())->sole();

    expect($meal->nutrition_facts)->toBeNull();

    $nutrition = app(MarketplaceMeals::class)->nutritionOf($meal);

    $projected = app(MarketplaceMealPresenter::class)->meal(
        $meal,
        'Verdant Kitchen',
        'en',
        new ResolvedPrice(4200, 'USD', 'price-list', 'price-list-item'),
        [],
        $nutrition,
        [],
        [],
        MarketplaceChannels::none(),
        [],
    );

    expect($projected['nutrition']['basis'] ?? null)->toBe('per_serving')
        ->and($projected['nutrition']['source']['kind'] ?? null)->toBe('ingredient_derived')
        ->and($projected['nutrition']['calculation']['method'] ?? null)->toBe('catalogue.nutrition.per_sold_unit')
        ->and($projected['nutrition']['total_grams'] ?? null)->toEqual(100);

    // The same object the amounts were scaled with, not a second opinion read
    // off a column that says nothing.
    expect($projected['serving'])->toBe($projected['nutrition']['serving'])
        ->and($projected['serving']['unit'] ?? null)->toBe('portion')
        ->and($projected['serving']['label'] ?? null)->toBe('')
        ->and($projected['serving']['grams'] ?? null)->toEqual(100);
});

/**
 * The sibling derivation, pinned here rather than in a file of its own because
 * it is the same claim about the same method's neighbour: what basis
 * `MarketplaceMeals` chooses for a meal that has both a published version and
 * its own ingredient rows.
 *
 * **This pins the basis choice, not the row-level policy.** The suite runs as
 * the schema owner, whom the policies on `recipe_versions` do not apply to, so
 * it cannot observe the failure that put `allergenCodesOf()` inside the
 * kitchen's tenant context: an anonymous marketplace read could not see the
 * version at all, fell silently to the weaker linked-ingredient basis, and
 * published a label that was not the frozen one. What a test *can* hold is the
 * half above the policy — that when the version is visible, its frozen label is
 * the answer — and it fails loudly if the wrap is ever removed in a way that
 * changes which basis is asked for.
 */
it('reports the published versions frozen allergen label over the items own ingredients', function (): void {
    $organisation = RecipeWorld::organisation();
    $recipe = Recipe::factory()->create(['organisation_id' => $organisation->getKey()]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisation->getKey(),
    ]);

    // Frozen at publication from the whole formulation — including a component
    // that never reaches the customer-facing ingredient summary.
    RecipeVersionAllergen::withoutTenancy()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $organisation->getKey(),
        'allergen_code' => RecipeWorld::allergen('gluten')->code,
        'containment' => AllergenContainment::Contains,
        'derivation' => AllergenDerivation::Derived,
    ]);

    $catalogue = Catalogue::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => 'default',
    ]);

    $created = CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $organisation->getKey(),
        'name_ar' => 'وجبة',
        'recipe_id' => $recipe->getKey(),
    ]);

    // The item's own list says sesame and says nothing about gluten. If the
    // projection were computing over this instead, the assertion below would
    // read `['sesame']` — which is the wrong label for this dish.
    $created->ingredients()->create([
        'organisation_id' => $organisation->getKey(),
        'ingredient_id' => RecipeWorld::mappedIngredient($organisation, 'Tahini', 'sesame')->getKey(),
        'display_order' => 1,
    ]);

    $meal = CatalogueItem::withoutTenancy()->whereKey($created->getKey())->sole();

    expect(app(MarketplaceMeals::class)->allergenCodesOf($meal))->toBe(['gluten']);
});
