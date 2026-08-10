<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| kitchen:publish-ready — the R-033 ambiguity guard
|--------------------------------------------------------------------------
|
| The command once published the highest-numbered draft of every recipe. That
| bit the Caesar Sauce: a recipe carrying the correct published version plus a
| leftover duplicate draft had the stale draft auto-published, demoting the
| correct version and making the live product under-declare sulphites.
|
| The guard: auto-publish only an unambiguous, never-published recipe with a
| single ready draft. A recipe that already has a published version and still
| carries a draft — or a never-published recipe with more than one draft — is
| ambiguous, so it is skipped and reported for a human to resolve.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    config()->set('kitchens.import.environments', ['local', 'testing']);

    $this->kitchen = RecipeWorld::kitchen('publish-ready-guard@kitchens.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * A recipe with one ready, publishable draft (v1), returned as its id.
 */
function guardReadyRecipe(object $kitchen, array $headers, string $grams, string $name): string
{
    $ingredient = RecipeWorld::mappedIngredient($kitchen->organisation, $name.' base', 'sesame');

    $recipeId = test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 250, 'unit_id' => $grams]],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    return (string) $recipeId;
}

/**
 * Drop the request-time tenant/user context so the command runs the way it
 * does in production: no authenticated caller, authority from the allowlist.
 */
function runPublishReadyAsOperator(): void
{
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
}

it('skips a recipe that already has a published version but still carries a draft, leaving the published version live', function (): void {
    $recipeId = guardReadyRecipe($this->kitchen, $this->headers, $this->grams, 'Caesar Sauce');

    // v1 is published — the correct incumbent.
    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    // v2 is a leftover duplicate draft — the R-033 trap. It is itself ready,
    // which is exactly why the command must not touch it: it cannot tell a
    // stale duplicate from a genuine pending revision.
    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.version.version_number', 2);

    runPublishReadyAsOperator();

    $this->artisan('kitchen:publish-ready', ['--org' => $this->kitchen->organisation->slug])
        ->expectsOutputToContain('has_published_version_and_pending_draft')
        ->assertSuccessful();

    $versions = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->get()->keyBy('version_number');

    // The correct version stays published; the duplicate draft was NOT
    // auto-published over it, and there is still exactly one published version.
    expect($versions[1]->status)->toBe(RecipeVersionStatus::Published)
        ->and($versions[2]->status)->toBe(RecipeVersionStatus::Draft)
        ->and(RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)
            ->where('status', RecipeVersionStatus::Published->value)->count())->toBe(1);
});

it('publishes a never-published recipe that has a single ready draft', function (): void {
    $recipeId = guardReadyRecipe($this->kitchen, $this->headers, $this->grams, 'Tahini Sauce');

    runPublishReadyAsOperator();

    $this->artisan('kitchen:publish-ready', ['--org' => $this->kitchen->organisation->slug])
        ->assertSuccessful();

    expect(RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole()->status)
        ->toBe(RecipeVersionStatus::Published);
});

it('skips a never-published recipe that has more than one draft rather than guessing the highest', function (): void {
    $recipeId = guardReadyRecipe($this->kitchen, $this->headers, $this->grams, 'Muhammara');

    // A second draft with no published version anywhere: picking the
    // highest-numbered one is a guess, and guessing is what caused R-033.
    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.version.version_number', 2);

    runPublishReadyAsOperator();

    $this->artisan('kitchen:publish-ready', ['--org' => $this->kitchen->organisation->slug])
        ->expectsOutputToContain('ambiguous_multiple_drafts')
        ->assertSuccessful();

    expect(RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)
        ->where('status', RecipeVersionStatus::Published->value)->count())->toBe(0)
        ->and(RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)
            ->where('status', RecipeVersionStatus::Draft->value)->count())->toBe(2);
});
