<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Derived nutrition on a sub-recipe's output — C2
|--------------------------------------------------------------------------
|
| A version that produces an ingredient *defines* that ingredient. There is no
| reference figure for "pesto mix" anywhere; there is only what this kitchen's
| formulation works out to, per 100 g of its finished mass. So publishing the
| component writes its own figures onto the row it outputs, and the formulation
| built on that row — a pesto mayonnaise — reaches a total by weighing its line
| of it like any other ingredient.
|
| Six things have to hold.
|
| 1. Publishing a component writes its per-100 g figures onto its output, on the
|    component's finished mass, and records which version they came from.
| 2. The parent's own snapshot then includes the component's contribution.
| 3. A correction two levels down — an ingredient inside the component —
|    reaches the parent's snapshot, through the component.
| 4. The derived figures are read-only: the fix for a wrong one is the recipe.
| 5. A component whose own figures are withheld withholds the parent's too, and
|    still claims the row so nobody types over the gap.
| 6. Retiring the component gives the row back.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('component-chef@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * The seven canonical figures with only energy parameterised.
 *
 * Holding the other six still is what makes a moved figure provably the
 * consequence of the edit under test rather than of arithmetic that ran anyway.
 *
 * @return array<string, mixed>
 */
function outputFacts(float|int $energy): array
{
    return RecipeWorld::nutritionEnvelope([
        'energy' => $energy, 'protein' => 8, 'carbohydrate' => 4,
        'fat' => 12, 'fibre' => 2, 'sugars' => 1, 'sodium' => 40,
    ]);
}

/**
 * A verified ingredient with facts, or with none when `$energy` is null — the
 * "nobody has recorded this" case that withholds a whole label.
 */
function outputIngredient(Organisation $organisation, string $name, float|int|null $energy): Ingredient
{
    return RecipeWorld::nourish(
        RecipeWorld::verifiedCleanIngredient($organisation, $name),
        $energy === null ? null : outputFacts($energy),
    );
}

/**
 * The energy amount off either envelope shape — the version's stored snapshot
 * or the slim set on an ingredient — or null when there is none.
 *
 * @param  array<string, mixed>|null  $facts
 */
function outputEnergy(?array $facts): ?float
{
    foreach ($facts['amounts'] ?? [] as $amount) {
        if (($amount['nutrient_id'] ?? null) === 'energy') {
            return (float) $amount['value'];
        }
    }

    return null;
}

/**
 * Publish version 1 of a new recipe and return its identifier.
 *
 * Through the API rather than by factory state, because the claim under test is
 * that the *publish path* writes the output's facts — a version whose status
 * was set by a factory never took that path.
 *
 * @param  array<string, string>  $headers
 * @param  list<array{0: Ingredient, 1: int|string}>  $lines  ingredient and grams
 * @param  array<string, mixed>  $details  version fields to PATCH before publication, such as a yield
 */
function publishedComponent(
    array $headers,
    string $grams,
    string $name,
    array $lines,
    ?Ingredient $output = null,
    array $details = [],
): string {
    $recipeId = (string) test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $base = "/api/v1/catalogue/recipes/{$recipeId}/versions/1";
    $lock = 0;

    test()->putJson($base.'/lines', [
        'lines' => array_map(
            static fn (array $line): array => [
                'ingredient_id' => (string) $line[0]->getKey(),
                'quantity' => $line[1],
                'unit_id' => $grams,
            ],
            $lines,
        ),
    ], $headers + ['If-Match' => '"'.$lock++.'"'])->assertOk();

    if ($details !== []) {
        test()->patchJson($base, $details, $headers + ['If-Match' => '"'.$lock++.'"'])->assertOk();
    }

    if ($output instanceof Ingredient) {
        test()->putJson($base.'/outputs', ['outputs' => [[
            'ingredient_id' => (string) $output->getKey(),
            'output_quantity' => 400,
            'unit_id' => $grams,
            'is_primary' => true,
        ]]], $headers + ['If-Match' => '"'.$lock++.'"'])->assertOk();
    }

    return (string) test()->postJson($base.'/publish', [], $headers + ['If-Match' => '"'.$lock.'"'])
        ->assertOk()
        ->json('data.version.id');
}

it('writes a published components own figures onto the ingredient it produces', function (): void {
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $oil = outputIngredient($this->kitchen->organisation, 'Olive Oil', 300);
    $mix = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Pesto Mix');

    $versionId = publishedComponent($this->headers, $this->grams, 'Pesto Mix Batch', [
        [$basil, 200],
        [$oil, 200],
    ], $mix);

    $mix->refresh();

    // 200 g at 100 kcal/100 g is 200 kcal, 200 g at 300 is 600, over the 400 g
    // that went in — 200 kcal per 100 g. The version states no yield, so the
    // finished mass is the input mass.
    expect($mix->nutrition_per_100g['basis'] ?? null)->toBe('per_100g')
        ->and(outputEnergy($mix->nutrition_per_100g))->toBe(200.0)
        // The link is what makes the figures read-only and what retirement
        // gives back. Without it the row is indistinguishable from one a
        // kitchen typed.
        ->and($mix->nutrition_derived_from_version_id)->toBe($versionId);

    // Seven amounts, not eight: no line carried saturates, and a partial sum of
    // them across some of the lines is worse than silence.
    expect($mix->nutrition_per_100g['amounts'] ?? [])->toHaveCount(7);
});

it('divides by a stated mass yield rather than by what went in', function (): void {
    // The same 800 kcal, over a batch that states it finishes at 200 g. The
    // difference is the water it lost, and a per-100 g figure computed on input
    // mass would understate the finished product by half.
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $oil = outputIngredient($this->kitchen->organisation, 'Olive Oil', 300);
    $reduction = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Basil Reduction');

    publishedComponent($this->headers, $this->grams, 'Basil Reduction Batch', [
        [$basil, 200],
        [$oil, 200],
    ], $reduction, ['yield_quantity' => '200', 'yield_unit_id' => $this->grams]);

    expect(outputEnergy($reduction->refresh()->nutrition_per_100g))->toBe(400.0);
});

it('carries the components contribution into the snapshot of the recipe built on it', function (): void {
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $oil = outputIngredient($this->kitchen->organisation, 'Olive Oil', 300);
    $mix = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Pesto Mix');

    publishedComponent($this->headers, $this->grams, 'Pesto Mix Batch', [
        [$basil, 200],
        [$oil, 200],
    ], $mix);

    $mayonnaise = outputIngredient($this->kitchen->organisation, 'Mayonnaise', 700);

    $parentId = publishedComponent($this->headers, $this->grams, 'Pesto Mayo', [
        [$mix, 300],
        [$mayonnaise, 100],
    ]);

    // 300 g of the mix at 200 kcal/100 g is 600 kcal, plus 100 g of mayonnaise
    // at 700 — and the first of those two figures exists only because
    // publishing the component wrote it.
    $facts = RecipeVersion::withoutTenancy()->whereKey($parentId)->sole()->nutrition_facts;

    expect(outputEnergy($facts))->toBe(1300.0)
        ->and($facts['total_grams'] ?? null)->toEqual(400);
});

it('reaches the parents snapshot when an ingredient inside the component is corrected', function (): void {
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $oil = outputIngredient($this->kitchen->organisation, 'Olive Oil', 300);
    $mix = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Pesto Mix');

    publishedComponent($this->headers, $this->grams, 'Pesto Mix Batch', [
        [$basil, 200],
        [$oil, 200],
    ], $mix);

    $parentId = publishedComponent($this->headers, $this->grams, 'Pesto Mayo', [[$mix, 300]]);

    expect(outputEnergy(RecipeVersion::withoutTenancy()->whereKey($parentId)->sole()->nutrition_facts))
        ->toBe(600.0);

    // Two hops from the parent, and the only edit anybody makes. The recompute
    // of the component rewrites the row the parent reads, and the invalidation
    // behind that write is what schedules the parent's own recompute; the queue
    // runs synchronously here, so both have happened by the next line.
    $url = '/api/v1/catalogue/ingredients/'.$basil->getKey();
    $etag = $this->getJson($url, $this->headers)->assertOk()->headers->get('ETag');

    $this->patchJson($url, ['nutrition_per_100g' => outputFacts(200)], $this->headers + ['If-Match' => (string) $etag])
        ->assertOk();

    // 200 g at 200 plus 200 g at 300 is 1000 kcal over 400 g — 250 per 100 g —
    // and 300 g of that is 750.
    expect(outputEnergy($mix->refresh()->nutrition_per_100g))->toBe(250.0)
        ->and(outputEnergy(RecipeVersion::withoutTenancy()->whereKey($parentId)->sole()->nutrition_facts))
        ->toBe(750.0);
});

it('refuses an edit to the facts and the density of a row a recipe derives', function (): void {
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $mix = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Pesto Mix');

    publishedComponent($this->headers, $this->grams, 'Pesto Mix Batch', [[$basil, 200]], $mix);

    $url = '/api/v1/catalogue/ingredients/'.$mix->getKey();
    $etag = (string) $this->getJson($url, $this->headers)->assertOk()->headers->get('ETag');

    // Both halves of the same arithmetic: the facts themselves, and the mass a
    // parent line stated in litres would be weighed through.
    $this->patchJson($url, ['nutrition_per_100g' => outputFacts(999)], $this->headers + ['If-Match' => $etag])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.fields.nutrition_per_100g.0',
            'These facts are derived from a published recipe version; change the recipe instead.');

    $this->patchJson($url, ['grams_per_unit' => 1080], $this->headers + ['If-Match' => $etag])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // Refused before anything was written, not rolled back after.
    expect(outputEnergy($mix->refresh()->nutrition_per_100g))->toBe(100.0)
        ->and($mix->grams_per_unit)->toBeNull();

    // An edit to anything else on the row is nobody's derivation and still
    // goes through.
    $this->patchJson($url, ['notes' => 'Made every Tuesday.'], $this->headers + ['If-Match' => $etag])
        ->assertOk();
});

it('withholds the parent when the components own figures are withheld', function (): void {
    // The withholding rule, one hop further out. A component with a line nobody
    // has recorded facts for has no publishable label of its own, and a parent
    // built on it must not quietly report a total short by exactly that line.
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $unknown = outputIngredient($this->kitchen->organisation, 'Nut Butter', null);
    $mix = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Pesto Mix');

    $versionId = publishedComponent($this->headers, $this->grams, 'Pesto Mix Batch', [
        [$basil, 200],
        [$unknown, 200],
    ], $mix);

    $mix->refresh();

    // Null facts, and the link set all the same: the row is still the recipe's
    // to state, so nobody papers over the gap by typing a number onto the
    // ingredient instead of fixing the formulation.
    expect($mix->nutrition_per_100g)->toBeNull()
        ->and($mix->nutrition_derived_from_version_id)->toBe($versionId);

    $parentId = publishedComponent($this->headers, $this->grams, 'Pesto Mayo', [[$mix, 300]]);

    expect(RecipeVersion::withoutTenancy()->whereKey($parentId)->sole()->nutrition_facts)->toBeNull();
});

it('gives the row back when the component is retired', function (): void {
    $basil = outputIngredient($this->kitchen->organisation, 'Basil', 100);
    $mix = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Pesto Mix');

    $componentId = publishedComponent($this->headers, $this->grams, 'Pesto Mix Batch', [[$basil, 200]], $mix);
    $parentId = publishedComponent($this->headers, $this->grams, 'Pesto Mayo', [[$mix, 300]]);

    expect(outputEnergy(RecipeVersion::withoutTenancy()->whereKey($parentId)->sole()->nutrition_facts))
        ->toBe(300.0);

    $component = RecipeVersion::withoutTenancy()->whereKey($componentId)->sole();

    $this->postJson("/api/v1/catalogue/recipes/{$component->recipe_id}/versions/1/retire", [],
        $this->headers + ['If-Match' => '"'.$component->lock_version.'"'])->assertOk();

    $mix->refresh();

    // The figures were true of a formulation that is no longer published, so
    // they go — and with them the claim on the row, which is now an ordinary
    // ingredient somebody may record facts for by hand.
    expect($mix->nutrition_per_100g)->toBeNull()
        ->and($mix->nutrition_derived_from_version_id)->toBeNull();

    // And the parent stops totalling against them.
    expect(RecipeVersion::withoutTenancy()->whereKey($parentId)->sole()->nutrition_facts)->toBeNull();
});
