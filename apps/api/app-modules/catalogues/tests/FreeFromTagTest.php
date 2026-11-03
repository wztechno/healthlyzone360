<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\DietClassification;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| A free-from tag never contradicts the allergen label
|--------------------------------------------------------------------------
|
| Owner, 3 Nov 2026: a tag that contradicts the label can't be saved or
| published. Dishes already on sale lose the tag on the customer side, and
| staff get a warning. "May contain" contradicts as much as "contains".
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('free-from@catalogue.test');
    $this->organisationId = (string) $this->a->organisation->getKey();
});

/** A meal whose label is its own listed ingredient, carrying `$allergen` at `$containment`. */
function freeFromMeal(object $tenant, string $allergen, AllergenContainment $containment, bool $published = false): CatalogueItem
{
    $factory = CatalogueItem::factory()->meal();

    $meal = ($published ? $factory->published() : $factory)->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'name_ar' => 'طبق',
    ]);

    CatalogueItemIngredient::factory()->create([
        'catalogue_item_id' => $meal->getKey(),
        'ingredient_id' => CatalogueWorld::mappedIngredient($tenant->organisation, 'Satay', $allergen, $containment)->getKey(),
    ]);

    return $meal;
}

/** A published meal whose label is its recipe's published version, declaring `$allergen` (or nothing). */
function freeFromRecipeMeal(object $tenant, ?string $allergen): CatalogueItem
{
    $organisationId = (string) $tenant->organisation->getKey();
    $recipe = Recipe::factory()->create(['organisation_id' => $organisationId]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisationId,
    ]);

    if ($allergen !== null) {
        RecipeVersionAllergen::factory()->create([
            'recipe_version_id' => $version->getKey(),
            'organisation_id' => $organisationId,
            'allergen_code' => CatalogueWorld::allergen($allergen)->code,
        ]);
    }

    return CatalogueItem::factory()->meal()->published()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $organisationId,
        'recipe_id' => $recipe->getKey(),
    ]);
}

/** Store tags directly, as an import or an earlier label did. */
function tagMeal(CatalogueItem $meal, string ...$codes): void
{
    foreach ($codes as $code) {
        CatalogueItemDietClassification::factory()->create([
            'catalogue_item_id' => $meal->getKey(),
            'diet_classification_id' => DietClassification::query()->where('code', $code)->sole()->getKey(),
        ]);
    }
}

/** @return list<string> */
function dietFilterMatches(CatalogueItem $meal, string $code): array
{
    $query = CatalogueItem::withoutTenancy()->whereKey($meal->getKey());
    app(MarketplaceMeals::class)->whereDietClassifications($query, [$code]);

    return array_values($query->pluck('id')->map(strval(...))->all());
}

it('refuses to save a free-from tag the label contradicts, may-contain included', function (): void {
    $meal = freeFromMeal($this->a, 'peanut', AllergenContainment::MayContain);

    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);
    $url = '/api/v1/catalogue/items/'.$meal->getKey().'/diet-classifications';

    $this->putJson($url, ['diet_classifications' => ['vegan', 'nut_free']], $headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.details.reason', 'diet_tag_contradicts_allergens')
        ->assertJsonPath('error.details.clashes', [['tag' => 'nut_free', 'allergen_codes' => ['peanut']]]);

    expect(CatalogueItemDietClassification::withoutTenancy()->where('catalogue_item_id', $meal->getKey())->count())->toBe(0);

    // A tag the label does not contradict saves as before.
    $this->putJson($url, ['diet_classifications' => ['vegan', 'gluten_free']], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.diet_classifications', ['vegan', 'gluten_free']);
});

it('refuses to publish a meal carrying a free-from tag its label contradicts', function (): void {
    $meal = freeFromMeal($this->a, 'milk', AllergenContainment::Contains);
    tagMeal($meal, 'dairy_free');

    $this->actingAs($this->a->user);

    $refused = $this->postJson('/api/v1/catalogue/items/'.$meal->getKey().'/publish', [], CatalogueWorld::headers($this->a) + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    $clash = collect($refused)->firstWhere('reason', 'diet_tag_contradicts_allergens');

    expect($clash)->not->toBeNull()
        ->and($clash['tag'])->toBe('dairy_free')
        ->and($clash['allergen_codes'])->toBe(['milk']);
});

it('hides an existing clash from the meal payload and the diet filter, on either label basis', function (): void {
    $meals = app(MarketplaceMeals::class);

    // The published recipe version's label, read through the definer function.
    $recipeMeal = freeFromRecipeMeal($this->a, 'tree_nut');
    tagMeal($recipeMeal, 'nut_free', 'vegan');

    // The meal's own listed ingredient, at "may contain".
    $listedMeal = freeFromMeal($this->a, 'gluten', AllergenContainment::MayContain, published: true);
    tagMeal($listedMeal, 'gluten_free', 'high_protein');

    expect($meals->dietClassificationCodesOf($recipeMeal))->toBe(['vegan'])
        ->and(dietFilterMatches($recipeMeal, 'nut_free'))->toBe([])
        ->and(dietFilterMatches($recipeMeal, 'vegan'))->toBe([(string) $recipeMeal->getKey()])
        ->and($meals->dietClassificationCodesOf($listedMeal))->toBe(['high_protein'])
        ->and(dietFilterMatches($listedMeal, 'gluten_free'))->toBe([]);
});

it('keeps a free-from tag when the published label says nothing, as the label does', function (): void {
    // A published version is the label even beside a listed ingredient carrying peanut,
    // which is DerivedAllergenService's order of authority.
    $meal = freeFromRecipeMeal($this->a, null);
    CatalogueItemIngredient::factory()->create([
        'catalogue_item_id' => $meal->getKey(),
        'ingredient_id' => CatalogueWorld::mappedIngredient($this->a->organisation, 'Satay', 'peanut')->getKey(),
    ]);
    tagMeal($meal, 'nut_free');

    expect(app(MarketplaceMeals::class)->allergenCodesOf($meal))->toBe([])
        ->and(app(MarketplaceMeals::class)->dietClassificationCodesOf($meal))->toBe(['nut_free'])
        ->and(dietFilterMatches($meal, 'nut_free'))->toBe([(string) $meal->getKey()]);
});

it('reads the meal tags in the same number of queries with and without a clash', function (): void {
    $meals = app(MarketplaceMeals::class);
    $count = function (CatalogueItem $meal) use ($meals): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $meals->dietClassificationCodesOf($meal);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    $clean = freeFromMeal($this->a, 'sesame', AllergenContainment::Contains, published: true);
    tagMeal($clean, 'nut_free', 'vegan');

    $clashing = freeFromMeal($this->a, 'peanut', AllergenContainment::Contains, published: true);
    tagMeal($clashing, 'nut_free', 'vegan');

    expect($count($clashing))->toBe($count($clean))
        ->and($meals->dietClassificationCodesOf($clean))->toBe(['vegan', 'nut_free'])
        ->and($meals->dietClassificationCodesOf($clashing))->toBe(['vegan']);
});
