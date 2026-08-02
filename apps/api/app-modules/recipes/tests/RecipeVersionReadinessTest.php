<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The readiness evaluator, and the only thing worth proving about it
|--------------------------------------------------------------------------
|
| `GET …/readiness` and `POST …/publish` must never disagree. The whole point
| of lifting the gates out of `publish()` into `RecipeVersionReadiness` is that
| there is now one implementation and two callers; the risk it creates is that
| somebody later "fixes" one of them. So every test here builds a state, asks
| the endpoint why it cannot publish, then attempts the publication and asserts
| the refusal names exactly the same reasons.
|
| `allergen_unmapped` is the one asymmetry, and it is deliberate. Publication
| raises it under its own error code — `catalogue.allergen_unmapped`, 422 —
| because the fix is in the ingredient's mapping editor rather than in the
| recipe. The evaluator has no such distinction to draw: it is asked "why not",
| and that is one more answer.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('readiness@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * A recipe, returned as its identifier. Version 1 exists and is empty.
 */
function readinessRecipe(array $headers, string $name): string
{
    return (string) test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');
}

/**
 * A publishable version 1 built with models rather than requests, for the
 * permission tests — where the caller under test deliberately cannot use the
 * write endpoints that would otherwise build it.
 */
function versionWithOneLine(object $kitchen, string $unitId): RecipeVersion
{
    $ingredient = RecipeWorld::mappedIngredient($kitchen->organisation, 'Tahini '.fake()->unique()->word(), 'sesame');

    $recipe = Recipe::factory()->create(['organisation_id' => $kitchen->organisation->getKey()]);

    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $kitchen->organisation->getKey(),
        'version_number' => 1,
    ]);

    RecipeVersionLine::withoutTenancy()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $kitchen->organisation->getKey(),
        'line_number' => 1,
        'ingredient_id' => $ingredient->getKey(),
        'quantity' => '250.0000',
        'unit_id' => $unitId,
    ]);

    return $version;
}

/**
 * What the readiness endpoint says, as `[publishable, reasons]`.
 *
 * @return array{0: bool, 1: list<array<string, mixed>>}
 */
function readinessOf(string $recipeId, array $headers): array
{
    $response = test()->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/readiness", $headers)->assertOk();

    return [(bool) $response->json('data.publishable'), (array) $response->json('data.reasons')];
}

/**
 * What the publish action refuses with, as machine codes in the order reported.
 *
 * @return list<string>
 */
function publishRefusalCodes(string $recipeId, array $headers, int $lockVersion): array
{
    $response = test()->postJson(
        "/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish",
        [],
        $headers + ['If-Match' => '"'.$lockVersion.'"'],
    );

    // The one gate with its own code. Flattened to the evaluator's vocabulary
    // so the two surfaces can be compared as sets rather than as shapes.
    if ($response->json('error.code') === 'catalogue.allergen_unmapped') {
        $response->assertStatus(422);

        return ['allergen_unmapped'];
    }

    $response->assertStatus(409)->assertJsonPath('error.code', 'catalogue.publish_blocked');

    /** @var list<string> */
    return collect($response->json('error.details.reasons'))->pluck('reason')->all();
}

it('reports a publishable version as publishable, and the publication then succeeds', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $recipeId = readinessRecipe($this->headers, 'Tahini Sauce');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 250, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeTrue()->and($reasons)->toBe([]);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();
});

it('reports and refuses a version with no lines identically', function (): void {
    $recipeId = readinessRecipe($this->headers, 'Empty Shell');

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())->toBe(['no_lines'])
        ->and($reasons[0]['detail'])->toBeString()->not->toBe('')
        ->and($reasons[0]['context'])->toBe([]);

    expect(publishRefusalCodes($recipeId, $this->headers, 0))->toBe(['no_lines']);
});

it('reports and refuses unquantified lines identically, naming the same line numbers', function (): void {
    $lemon = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon Juice', 'sulphites');
    $recipeId = readinessRecipe($this->headers, 'Indicative Dressing');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $lemon->getKey()]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())->toBe(['line_quantity_missing'])
        // The structured extras live under `context` rather than beside the
        // code, so a reason that carries new structure never changes the shape
        // of a reason.
        ->and($reasons[0]['context']['line_numbers'])->toBe([1]);

    expect(publishRefusalCodes($recipeId, $this->headers, 1))->toBe(['line_quantity_missing']);
});

it('reports and refuses a quarantined ingredient identically', function (): void {
    // Mapped *and* under review: the mapping keeps `allergen_unmapped` out of
    // the way so this test is about the one reason it is named for.
    $burghul = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Burghul', 'gluten');

    Ingredient::withoutTenancy()->whereKey($burghul->getKey())->update([
        'verification_status' => IngredientVerificationStatus::RequiresReview->value,
    ]);

    $recipeId = readinessRecipe($this->headers, 'Tabbouleh');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $burghul->getKey(), 'quantity' => 100, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())->toBe(['ingredient_requires_review'])
        ->and($reasons[0]['context']['ingredient_ids'])->toBe([(string) $burghul->getKey()]);

    expect(publishRefusalCodes($recipeId, $this->headers, 1))->toBe(['ingredient_requires_review']);
});

it('reports an unassessed ingredient as a reason, where publication raises its own code', function (): void {
    $mystery = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Spice Blend');
    $recipeId = readinessRecipe($this->headers, 'Mystery Rub');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $mystery->getKey(), 'quantity' => 10, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())->toBe(['allergen_unmapped'])
        ->and($reasons[0]['context']['ingredient_ids'])->toBe([(string) $mystery->getKey()]);

    // Same conclusion, different error code — because the fix is in a
    // different place.
    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'catalogue.allergen_unmapped')
        ->assertJsonPath('error.details.ingredient_ids', [(string) $mystery->getKey()]);
});

it('reports and refuses a quarantined version identically, carrying its reason', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $recipeId = readinessRecipe($this->headers, 'Quarantined Sauce');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 250, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->update([
        'status' => RecipeVersionStatus::ReviewRequired->value,
        'review_reason' => 'Allergen recompute changed the published label: now declares peanut.',
    ]);

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())->toBe(['version_quarantined'])
        ->and($reasons[0]['context']['review_reason'])->toContain('peanut');

    expect(publishRefusalCodes($recipeId, $this->headers, 1))->toBe(['version_quarantined']);
});

it('reports and refuses a version that is not a draft identically', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $recipeId = readinessRecipe($this->headers, 'Already Live');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 250, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    [$publishable, $reasons] = readinessOf($recipeId, $this->headers);

    expect($publishable)->toBeFalse()
        ->and(collect($reasons)->pluck('code')->all())->toBe(['version_not_a_draft'])
        ->and($reasons[0]['context']['status'])->toBe('published');

    expect(publishRefusalCodes($recipeId, $this->headers, 2))->toBe(['version_not_a_draft']);
});

it('collects every blocker in one answer, exactly as the refusal does', function (): void {
    // A version missing its quantities *and* built on an ingredient nobody has
    // assessed. The point of the whole apparatus is that one round trip tells
    // a kitchen both things.
    $mystery = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Unknown Powder');
    $recipeId = readinessRecipe($this->headers, 'Two Problems');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $mystery->getKey()]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    [, $reasons] = readinessOf($recipeId, $this->headers);

    expect(collect($reasons)->pluck('code')->all())->toBe(['line_quantity_missing', 'allergen_unmapped']);

    // Publication reports the structural half first and stops there, because
    // the allergen gate is raised separately and the version never reaches it.
    expect(publishRefusalCodes($recipeId, $this->headers, 1))->toBe(['line_quantity_missing']);
});

it('carries the version state in meta, so a client never has to ask twice', function (): void {
    $tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $recipeId = readinessRecipe($this->headers, 'Meta Sauce');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $tahini->getKey(), 'quantity' => 250, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/readiness", $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.recipe_id', $recipeId)
        ->assertJsonPath('meta.version_number', 1)
        ->assertJsonPath('meta.status', 'draft')
        ->assertJsonPath('meta.derivation_state', 'stale');
});

it('is a read, so it needs the read permission and not the publish one', function (): void {
    // A chef who may look at formulations but may not decide what the kitchen
    // sells. Diagnosing a version is their job; publishing it is not.
    $reader = RecipeWorld::kitchen('reader@recipes.test', [
        'catalogue.view_organisation',
        'recipe.view_organisation',
    ]);

    $version = versionWithOneLine($reader, $this->grams);

    forgetResolvedGuards();
    $this->actingAs($reader->user);

    $this->getJson('/api/v1/catalogue/recipes/'.$version->recipe_id.'/versions/1/readiness', RecipeWorld::headers($reader))
        ->assertOk()
        ->assertJsonPath('data.publishable', true);

    // And somebody with no recipe read permission at all sees nothing, even
    // in their own kitchen.
    $stranger = RecipeWorld::kitchen('stranger@recipes.test', ['catalogue.view_organisation']);
    $strangerVersion = versionWithOneLine($stranger, $this->grams);

    forgetResolvedGuards();
    $this->actingAs($stranger->user);

    $this->getJson('/api/v1/catalogue/recipes/'.$strangerVersion->recipe_id.'/versions/1/readiness', RecipeWorld::headers($stranger))
        ->assertStatus(403);
});
