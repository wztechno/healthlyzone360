<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| What recipes make true about ingredients
|--------------------------------------------------------------------------
|
| The two directions of the K1.1 ↔ K1.2 seam, both routed through
| `IngredientUsageRegistry` so the module graph stays Recipes → Ingredients:
|
| 1. An ingredient a live formulation names cannot be archived.
| 2. A change to an ingredient's allergen mappings makes every published
|    label that depends on it stale — synchronously — and queues the K1.8
|    recompute that re-derives it and quarantines what no longer matches.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('food-safety@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);

    $this->tahini = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $this->recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Tahini Sauce'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $this->tahini->getKey(), 'quantity' => 250, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();
});

it('refuses to archive an ingredient a live recipe version still names', function (): void {
    $this->postJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/archive', [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.in_use')
        ->assertJsonPath('error.details.recipe_ids', [$this->recipeId]);

    expect(Ingredient::withoutTenancy()->whereKey($this->tahini->getKey())->sole()->status)
        ->toBe(IngredientStatus::Active);
});

it('refuses just as firmly when the ingredient is only an output', function (): void {
    $produced = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Pesto Mix', 'tree_nut');

    $this->putJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/outputs", [
        'outputs' => [[
            'ingredient_id' => (string) $produced->getKey(),
            'output_quantity' => 900,
            'unit_id' => $this->grams,
            'is_primary' => true,
        ]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->postJson('/api/v1/catalogue/ingredients/'.$produced->getKey().'/archive', [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.in_use');
});

it('allows the archive once every referencing version is retired', function (): void {
    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/retire", [],
        $this->headers + ['If-Match' => '"2"'])->assertOk();

    // History is allowed to point at an archived ingredient — that is what
    // makes an old label reconstructable — so a retired version is not a
    // blocker.
    $this->postJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/archive', [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.ingredient.status', 'archived');
});

it('refuses to build a formulation out of an archived ingredient', function (): void {
    $retired = Ingredient::factory()->archived()->create([
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'name_en' => 'Discontinued Powder',
    ]);

    $this->putJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $retired->getKey(), 'quantity' => 5, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('marks a published label stale when the mappings underneath it change', function (): void {
    // Marking is what the *write* does, and it is synchronous because a label
    // whose basis has moved must not look current for even one read. The
    // recompute that follows is a queued job (K1.8), faked here so that this
    // test is about the marking alone.
    Queue::fake();

    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.version.derivation_state', 'current');

    $this->putJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => RecipeWorld::allergen('sesame')->code, 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => 'may_contain'],
        ],
    ], $this->headers)->assertOk();

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $this->recipeId)->sole();

    expect($version->derivation_state)->toBe(DerivationState::Stale);

    Queue::assertPushed(
        RecomputeRecipeDerivations::class,
        fn (RecomputeRecipeDerivations $job): bool => $job->recipeVersionId === (string) $version->getKey()
            && $job->organisationId === (string) $this->kitchen->organisation->getKey(),
    );

    $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/allergens", $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.derivation_state', 'stale')
        // The frozen label has not moved *on the read path*: it is the record
        // of what was published, and a GET that silently recomputed it would
        // destroy the only evidence of what a customer was shown. Rewriting it
        // is the job's business, and the job takes the version off sale in the
        // same breath.
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.allergen_code', 'sesame');
});

it('recomputes the label, quarantines the published version and names the delta', function (): void {
    // The same edit as above with the queue running — the K1.8 behaviour the
    // K1.2 slice deferred. The version was promising sesame and only sesame;
    // it now also implies peanut, and a promise that changed is a promise a
    // human has to look at before the dish goes back on sale.
    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->putJson('/api/v1/catalogue/ingredients/'.$this->tahini->getKey().'/allergens', [
        'mappings' => [
            ['allergen_code' => RecipeWorld::allergen('sesame')->code, 'containment' => 'contains'],
            ['allergen_code' => RecipeWorld::allergen('peanut')->code, 'containment' => 'may_contain'],
        ],
    ], $this->headers)->assertOk();

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $this->recipeId)->sole();

    expect($version->status)->toBe(RecipeVersionStatus::ReviewRequired)
        ->and($version->derivation_state)->toBe(DerivationState::Current)
        ->and($version->review_reason)->toContain('peanut');

    $this->getJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/1/allergens", $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.derivation_state', 'current')
        ->assertJsonCount(2, 'data');

    // Republishing is how a kitchen accepts the new label: a fresh version
    // carrying both classes, published deliberately.
    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated();

    $this->postJson("/api/v1/catalogue/recipes/{$this->recipeId}/versions/2/publish", [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.version.derivation_state', 'current')
        ->assertJsonCount(2, 'data.allergens');
});
