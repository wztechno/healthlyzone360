<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| Sub-recipe allergens carry through — T3
|--------------------------------------------------------------------------
|
| A published sub-recipe (an in-house sauce) writes its frozen label onto the
| ingredient it produces, the way its nutrition already is, so every dish built
| on the sauce picks the allergens up — and a dish whose published label moves
| goes to review.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('carry-chef@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * Publish version 1 of a new recipe through the API, optionally producing
 * `$output`, and return the version identifier.
 *
 * @param  array<string, string>  $headers
 * @param  list<Ingredient>  $ingredients
 */
function carryPublished(array $headers, string $grams, string $name, array $ingredients, ?Ingredient $output = null): string
{
    $recipeId = (string) test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $base = "/api/v1/catalogue/recipes/{$recipeId}/versions/1";
    $lock = 0;

    test()->putJson($base.'/lines', [
        'lines' => array_map(static fn (Ingredient $ingredient): array => [
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 250,
            'unit_id' => $grams,
        ], $ingredients),
    ], $headers + ['If-Match' => '"'.$lock++.'"'])->assertOk();

    if ($output instanceof Ingredient) {
        test()->putJson($base.'/outputs', ['outputs' => [[
            'ingredient_id' => (string) $output->getKey(),
            'output_quantity' => 500,
            'unit_id' => $grams,
            'is_primary' => true,
        ]]], $headers + ['If-Match' => '"'.$lock++.'"'])->assertOk();
    }

    return (string) test()->postJson($base.'/publish', [], $headers + ['If-Match' => '"'.$lock.'"'])
        ->assertOk()
        ->json('data.version.id');
}

/**
 * An organisation-layer mapping written by hand, as a kitchen's own row.
 */
function carryManualRow(Ingredient $ingredient, string $code, AllergenContainment $containment): void
{
    IngredientAllergen::withoutTenancy()->create([
        'ingredient_id' => $ingredient->getKey(),
        'organisation_id' => $ingredient->organisation_id,
        'allergen_code' => RecipeWorld::allergen($code)->code,
        'containment' => $containment,
        'market_scope' => 'all',
        'source' => 'kitchen_declared',
        'verification_status' => 'verified',
    ]);
}

/**
 * Every mapping row on an ingredient, as class → "containment:source".
 *
 * @return array<string, string>
 */
function carryRows(Ingredient $ingredient): array
{
    return IngredientAllergen::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->orderBy('allergen_code')
        ->get()
        ->mapWithKeys(static fn (IngredientAllergen $row): array => [$row->allergen_code => $row->containment->value.':'.$row->source->value])
        ->all();
}

/**
 * @param  list<string>  $visited
 */
function carryRecompute(string $versionId, string $organisationId, int $depth = 0, array $visited = []): void
{
    app()->call([new RecomputeRecipeDerivations($versionId, $organisationId, $depth, $visited), 'handle']);
}

it('carries a sauces allergens onto its output and into the dish label', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $sauce = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Tahini Sauce');

    $sauceVersionId = carryPublished($this->headers, $this->grams, 'Tahini Sauce Batch', [$tahini], $sauce);

    expect(carryRows($sauce))->toBe(['sesame' => 'contains:recipe_derived'])
        ->and($sauce->refresh()->allergens_derived_from_version_id)->toBe($sauceVersionId)
        ->and(IngredientAllergen::withoutTenancy()->where('ingredient_id', $sauce->getKey())->value('derived_from_version_id'))
        ->toBe($sauceVersionId);

    // The sauce was unassessed by hand; publishing a dish on it now goes
    // through, and the dish's label names the sauce as the source of sesame.
    $dishId = carryPublished($this->headers, $this->grams, 'Falafel Wrap', [$sauce]);

    $label = RecipeVersionAllergen::withoutTenancy()->where('recipe_version_id', $dishId)->get();

    expect($label)->toHaveCount(1)
        ->and($label->first()->allergen_code)->toBe('sesame')
        ->and($label->first()->containment)->toBe(AllergenContainment::Contains)
        ->and($label->first()->source_ingredient_id)->toBe((string) $sauce->getKey());
});

it('sends a published dish to review when the sauce under it starts carrying an allergen', function (): void {
    $sauce = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'House Sauce');
    $dishId = carryPublished($this->headers, $this->grams, 'Grain Bowl', [$sauce]);

    expect(RecipeVersion::withoutTenancy()->whereKey($dishId)->sole()->status)->toBe(RecipeVersionStatus::Published);

    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    carryPublished($this->headers, $this->grams, 'House Sauce Batch', [$tahini], $sauce);

    $dish = RecipeVersion::withoutTenancy()->whereKey($dishId)->sole();

    expect($dish->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($dish->review_reason)->toContain('sesame')
        ->and($dish->previous_label)->toBe([]);
});

it('stops a cycle: the job writes outputs without scheduling, and the walk keeps its visited set and depth cap', function (): void {
    $first = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Component One', 'sesame');
    $second = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Component Two', 'soy');

    $aId = carryPublished($this->headers, $this->grams, 'Makes One', [$second]);
    $bId = carryPublished($this->headers, $this->grams, 'Makes Two', [$first]);

    $organisationId = (string) $this->kitchen->organisation->getKey();

    RecipeVersion::withoutTenancy()->whereKey($aId)->sole()->outputs()->create([
        'organisation_id' => $organisationId, 'ingredient_id' => $first->getKey(),
        'output_quantity' => '500.0000', 'unit_id' => $this->grams, 'is_primary' => true,
    ]);
    RecipeVersion::withoutTenancy()->whereKey($bId)->sole()->outputs()->create([
        'organisation_id' => $organisationId, 'ingredient_id' => $second->getKey(),
        'output_quantity' => '500.0000', 'unit_id' => $this->grams, 'is_primary' => true,
    ]);

    Queue::fake();

    carryRecompute($aId, $organisationId);

    // A's label (soy) reached its output, and the only job queued is the
    // walk's own hop to B — the writer scheduled nothing.
    expect(carryRows($first))->toBe(['sesame' => 'contains:kitchen_declared', 'soy' => 'contains:recipe_derived']);
    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);

    /** @var RecomputeRecipeDerivations $next */
    $next = Queue::pushed(RecomputeRecipeDerivations::class)->sole();

    expect($next->recipeVersionId)->toBe($bId)->and($next->visited)->toBe([$aId]);

    carryRecompute($bId, $organisationId, $next->depth, $next->visited);

    // B carries sesame onto its output, and A — already visited — is not
    // queued again.
    expect(carryRows($second))->toBe(['sesame' => 'contains:recipe_derived', 'soy' => 'contains:kitchen_declared']);
    Queue::assertPushed(RecomputeRecipeDerivations::class, 1);

    expect(RecomputeRecipeDerivations::MAX_DEPTH)->toBe(5);
});

it('keeps a kitchens manual row and only ever strengthens it', function (): void {
    $sauce = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Pesto');
    carryManualRow($sauce, 'sesame', AllergenContainment::MayContain);
    carryManualRow($sauce, 'milk', AllergenContainment::Contains);

    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $cream = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Shared-line Cream');
    carryManualRow($cream, 'milk', AllergenContainment::MayContain);

    carryPublished($this->headers, $this->grams, 'Pesto Batch', [$tahini, $cream], $sauce);

    // Sesame raised to the derived contains; milk not weakened to the derived
    // may_contain. Both stay the kitchen's rows.
    expect(carryRows($sauce))->toBe([
        'milk' => 'contains:kitchen_declared',
        'sesame' => 'contains:kitchen_declared',
    ]);
});

it('clears the derived rows and the claim when the sauce is retired', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $sauce = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Tahini Sauce');

    $versionId = carryPublished($this->headers, $this->grams, 'Tahini Sauce Batch', [$tahini], $sauce);

    expect(carryRows($sauce))->toBe(['sesame' => 'contains:recipe_derived']);

    $version = RecipeVersion::withoutTenancy()->whereKey($versionId)->sole();

    $this->postJson("/api/v1/catalogue/recipes/{$version->recipe_id}/versions/1/retire", [],
        $this->headers + ['If-Match' => '"'.$version->lock_version.'"'])->assertOk();

    expect(carryRows($sauce))->toBe([])
        ->and($sauce->refresh()->allergens_derived_from_version_id)->toBeNull();
});

it('counts an output whose sauce carries nothing as determined', function (): void {
    $chickpeas = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Chickpeas');
    $base = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Hummus Base');

    $versionId = carryPublished($this->headers, $this->grams, 'Hummus Base Batch', [$chickpeas], $base);

    expect(carryRows($base))->toBe([])
        ->and($base->refresh()->allergens_derived_from_version_id)->toBe($versionId);

    // No mapping row and not verified by hand, yet the dish publishes: the
    // sauce's empty label is the assessment.
    carryPublished($this->headers, $this->grams, 'Hummus Plate', [$base]);
});

it('refuses a mapping edit to a derived row and keeps it through a replace', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $sauce = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Tahini Sauce');
    carryPublished($this->headers, $this->grams, 'Tahini Sauce Batch', [$tahini], $sauce);

    $url = '/api/v1/catalogue/ingredients/'.$sauce->getKey().'/allergens';
    $milk = RecipeWorld::allergen('milk')->code;

    $this->putJson($url, ['mappings' => [['allergen_code' => 'sesame', 'containment' => 'may_contain']]], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.derived_allergen_classes', ['sesame']);

    $this->putJson($url, ['mappings' => [['allergen_code' => 'sesame', 'containment' => 'contains', 'source' => 'recipe_derived']]], $this->headers)
        ->assertStatus(422);

    // An unchanged echo is not an edit; the kitchen's own addition is its row.
    $this->putJson($url, ['mappings' => [
        ['allergen_code' => 'sesame', 'containment' => 'contains'],
        ['allergen_code' => $milk, 'containment' => 'may_contain'],
    ]], $this->headers)->assertOk();

    expect(carryRows($sauce))->toBe(['milk' => 'may_contain:kitchen_declared', 'sesame' => 'contains:recipe_derived']);

    // A replace that omits the derived row removes only the kitchen's own.
    $this->putJson($url, ['mappings' => []], $this->headers)->assertOk();

    expect(carryRows($sauce))->toBe(['sesame' => 'contains:recipe_derived']);
});

it('lists the dishes that would go to review on a dry run and writes nothing', function (): void {
    // A sauce published before carry-through existed: its output was named
    // after publication, so nothing carried.
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $sauce = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Legacy Sauce');

    $sauceId = carryPublished($this->headers, $this->grams, 'Legacy Sauce Batch', [$tahini]);
    $dishId = carryPublished($this->headers, $this->grams, 'Legacy Bowl', [$sauce]);

    RecipeVersion::withoutTenancy()->whereKey($sauceId)->sole()->outputs()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(), 'ingredient_id' => $sauce->getKey(),
        'output_quantity' => '500.0000', 'unit_id' => $this->grams, 'is_primary' => true,
    ]);

    $mappings = IngredientAllergen::withoutTenancy()->count();
    $labels = RecipeVersionAllergen::withoutTenancy()->count();

    Queue::fake();

    $this->artisan('recipes:carry-allergens', ['--dry-run' => true])
        ->expectsOutputToContain('Legacy Bowl (v1)')
        ->expectsOutputToContain('Dry run: 1 output ingredient(s) would change; 1 dish(es) would go to review. Nothing was written.')
        ->assertSuccessful();

    expect(IngredientAllergen::withoutTenancy()->count())->toBe($mappings)
        ->and(RecipeVersionAllergen::withoutTenancy()->count())->toBe($labels)
        ->and(carryRows($sauce))->toBe([])
        ->and($sauce->refresh()->allergens_derived_from_version_id)->toBeNull()
        ->and(RecipeVersion::withoutTenancy()->whereKey($dishId)->sole()->status)->toBe(RecipeVersionStatus::Published);

    Queue::assertNothingPushed();
});
