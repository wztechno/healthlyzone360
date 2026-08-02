<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The recipe publication lifecycle — the K1.2 gate
|--------------------------------------------------------------------------
|
| Draft → published → retired, and the readiness evaluator that decides
| whether the middle step is allowed. What has to hold: a published version is
| frozen; a quarantined one cannot be published at all; an ingredient nobody
| has assessed blocks publication; publishing freezes a label with provenance
| and demotes whatever was live; and an identical republish produces an
| identical derivation hash.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('head-chef@recipes.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();

    $this->actingAs($this->kitchen->user);
});

/**
 * A recipe with one publishable line, returned as `[recipeId, ingredient]`.
 */
function publishableRecipe(object $kitchen, array $headers, string $grams, string $name = 'Tahini Sauce'): array
{
    $ingredient = RecipeWorld::mappedIngredient($kitchen->organisation, 'Tahini', 'sesame');

    $recipeId = test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 250, 'unit_id' => $grams]],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    return [$recipeId, $ingredient];
}

it('publishes a ready draft, freezes the label with provenance and records the derivation', function (): void {
    [$recipeId, $ingredient] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $response = $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published')
        ->assertJsonPath('data.version.derivation_state', 'current')
        ->assertJsonPath('data.allergens.0.allergen_code', 'sesame')
        ->assertJsonPath('data.allergens.0.derivation', 'derived')
        // Provenance is what makes a warning trusted: "sesame, from tahini"
        // is acted on where a bare "sesame" is clicked past.
        ->assertJsonPath('data.allergens.0.source_ingredient_id', (string) $ingredient->getKey());

    expect($response->json('data.version.published_at'))->not->toBeNull()
        ->and($response->json('data.version.derived_at'))->not->toBeNull();

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    expect($version->derived_input_hash)->toHaveLength(64)
        ->and($version->published_by)->toBe((string) $this->kitchen->user->getKey());

    // The fingerprint is never on the wire: a client that could compare hashes
    // would compare hashes instead of reading derivation_state.
    $response->assertJsonMissingPath('data.version.derived_input_hash');

    expect(AuditLog::query()->where('action', 'catalogue.recipe_version_published')->count())->toBe(1);
});

it('blocks publication of a version whose lines carry no quantity, and names the lines', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon Juice', 'sulphites');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Indicative Dressing'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    // Exactly what the sauces-and-dressings source provides: typical
    // ingredients and no amounts at all.
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey()]],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.lines.0.quantity', null);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->assertJsonPath('error.details.reasons.0.reason', 'line_quantity_missing')
        ->assertJsonPath('error.details.reasons.0.line_numbers', [1]);

    expect(RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole()->status)
        ->toBe(RecipeVersionStatus::Draft);
});

it('blocks publication of a version with no lines at all', function (): void {
    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Empty Shell'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(409)
        ->assertJsonPath('error.details.reasons.0.reason', 'no_lines');
});

it('refuses to publish while an ingredient carries no allergen determination', function (): void {
    $unmapped = RecipeWorld::unmappedIngredient($this->kitchen->organisation, 'Mystery Powder');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Unknowable Rub'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $unmapped->getKey(), 'quantity' => 10, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'catalogue.allergen_unmapped')
        ->assertJsonPath('error.details.ingredient_ids', [(string) $unmapped->getKey()]);
});

it('accepts an ingredient verified to carry nothing, because the absence was recorded', function (): void {
    // Zero mapping rows *and* zero assessment is silence. Zero mapping rows
    // with `verified` is a statement, and only the second may reach a plate.
    $clean = RecipeWorld::verifiedCleanIngredient($this->kitchen->organisation, 'Filtered Water');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Simple Brine'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $clean->getKey(), 'quantity' => 1000, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published')
        ->assertJsonPath('data.allergens', []);
});

it('refuses to publish a recipe containing an ingredient awaiting allergen review', function (): void {
    // The burghul/pita contradiction (appendix D, risk R1): the source tags it
    // allergen-free while its own key does not.
    $quarantined = RecipeWorld::quarantinedIngredient($this->kitchen->organisation, 'Burghul');

    IngredientAllergen::withoutTenancy()->create([
        'ingredient_id' => $quarantined->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'allergen_code' => RecipeWorld::allergen('gluten')->code,
        'containment' => AllergenContainment::Contains,
        'market_scope' => 'all',
        'source' => 'master_list',
        'verification_status' => 'requires_review',
    ]);

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Tabbouleh Base'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $quarantined->getKey(), 'quantity' => 200, 'unit_id' => $this->grams]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->assertJsonPath('error.details.reasons.0.reason', 'ingredient_requires_review')
        ->assertJsonPath('error.details.reasons.0.ingredient_ids', [(string) $quarantined->getKey()]);
});

it('blocks publication of a quarantined version structurally', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    // The quarantine state is stored, not a flag beside the status: a publish
    // path can forget to read a flag.
    RecipeVersion::withoutTenancy()->whereKey($version->getKey())->update([
        'status' => RecipeVersionStatus::ReviewRequired->value,
        'review_reason' => 'Allergen determination contradicts the source workbook.',
    ]);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->assertJsonPath('error.details.reasons.0.reason', 'version_quarantined')
        ->assertJsonPath('error.details.reasons.0.review_reason', 'Allergen determination contradicts the source workbook.');

    // ...and it is still editable, because the point of quarantine is that
    // somebody fixes it.
    $this->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1",
        ['notes' => 'Escalated to the food-safety lead.'], $this->headers + ['If-Match' => '"1"'])
        ->assertOk();
});

it('freezes a published version against every content write', function (): void {
    [$recipeId, $ingredient] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $base = "/api/v1/catalogue/recipes/{$recipeId}/versions/1";
    $current = $this->headers + ['If-Match' => '"2"'];

    $this->patchJson($base, ['notes' => 'Sneaky edit'], $current)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.version_immutable')
        ->assertJsonPath('error.details.status', 'published');

    $this->putJson($base.'/lines', ['lines' => []], $current)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.version_immutable');

    $this->putJson($base.'/outputs', ['outputs' => []], $current)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.version_immutable');

    $this->putJson($base.'/steps', ['steps' => []], $current)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.version_immutable');

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    expect($version->notes)->toBeNull()
        ->and(RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->count())->toBe(1)
        ->and($ingredient->exists)->toBeTrue();
});

it('demotes the previous published version when a newer one is published', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.version.version_number', 2);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/2/publish", [],
        $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published');

    $statuses = RecipeVersion::withoutTenancy()
        ->where('recipe_id', $recipeId)
        ->orderBy('version_number')
        ->get()
        ->map(static fn (RecipeVersion $version): string => $version->status->value)
        ->all();

    expect($statuses)->toBe(['retired', 'published']);

    // The partial unique index is the mechanism, not a service that remembers
    // to keep a pointer in step.
    expect(RecipeVersion::withoutTenancy()
        ->where('recipe_id', $recipeId)
        ->where('status', RecipeVersionStatus::Published->value)
        ->count())->toBe(1);

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.recipe.published_version_number', 2);
});

it('produces an identical derivation hash for an identical republish', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/2/publish", [],
        $this->headers + ['If-Match' => '"0"'])->assertOk();

    $hashes = RecipeVersion::withoutTenancy()
        ->where('recipe_id', $recipeId)
        ->orderBy('version_number')
        ->pluck('derived_input_hash')
        ->all();

    // Same formulation, same mappings: the same derivation. A hash that said
    // otherwise would make "has anything really changed" unanswerable.
    expect($hashes[0])->toBe($hashes[1]);
});

it('retires a published version and refuses to retire anything else', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/retire", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/retire", [],
        $this->headers + ['If-Match' => '"2"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'retired');

    expect(AuditLog::query()->where('action', 'catalogue.recipe_version_retired')->count())->toBe(1);
});

it('carries lines, outputs, steps and declared allergens into a copied draft', function (): void {
    [$recipeId, $ingredient] = publishableRecipe($this->kitchen, $this->headers, $this->grams);
    $produced = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Pesto Mix', 'tree_nut');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/outputs", [
        'outputs' => [[
            'ingredient_id' => (string) $produced->getKey(),
            'output_quantity' => 900,
            'unit_id' => $this->grams,
            'is_primary' => true,
        ]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/steps", [
        'steps' => [
            ['instruction_en' => 'Blend the tahini with cold water.', 'minutes' => 3],
            ['instruction_en' => 'Season and rest.', 'instruction_ar' => 'تبّل واترك ليرتاح.'],
        ],
    ], $this->headers + ['If-Match' => '"2"'])->assertOk();

    $first = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->where('version_number', 1)->sole();

    // A chef's declaration: the fryer is shared, and no mapping implies it.
    RecipeVersionAllergen::withoutTenancy()->create([
        'recipe_version_id' => $first->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'allergen_code' => RecipeWorld::allergen('peanut')->code,
        'containment' => AllergenContainment::MayContain,
        'derivation' => AllergenDerivation::Declared,
        'source_note' => 'Shared fryer.',
    ]);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions", ['copy_from_version' => 1], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.version.version_number', 2)
        ->assertJsonPath('data.version.status', 'draft')
        ->assertJsonPath('data.version.lock_version', 0);

    $second = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->where('version_number', 2)->sole();

    expect(RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $second->getKey())->pluck('ingredient_id')->all())
        ->toBe([(string) $ingredient->getKey()])
        ->and(RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $second->getKey())->count())->toBe(1)
        ->and(RecipeVersionStep::withoutTenancy()->where('recipe_version_id', $second->getKey())->count())->toBe(2)
        ->and(RecipeVersionAllergen::withoutTenancy()->where('recipe_version_id', $second->getKey())->pluck('allergen_code')->all())
        ->toBe(['peanut']);

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/2", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.steps.0.step_number', 1)
        ->assertJsonPath('data.steps.1.instruction_ar', 'تبّل واترك ليرتاح.')
        ->assertJsonPath('data.outputs.0.is_primary', true);
});

it('never lets a derived row weaken a chefs declaration', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    // The chef says the sesame is definitely there; the mapping only implies
    // it at the same strength, so the declaration must survive publication.
    RecipeVersionAllergen::withoutTenancy()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'allergen_code' => RecipeWorld::allergen('sesame')->code,
        'containment' => AllergenContainment::Contains,
        'derivation' => AllergenDerivation::Declared,
        'source_note' => 'Confirmed with the supplier.',
    ]);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])->assertOk();

    $rows = RecipeVersionAllergen::withoutTenancy()->where('recipe_version_id', $version->getKey())->get();

    expect($rows)->toHaveCount(1)
        ->and($rows->first()?->derivation)->toBe(AllergenDerivation::Declared)
        ->and($rows->first()?->source_note)->toBe('Confirmed with the supplier.');
});

it('accepts duplicate ingredient lines, because a stage is not a duplicate', function (): void {
    $oil = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Olive Oil', 'sesame');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Two-Stage Marinade'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    // Olive oil in the marinade and again in the finish is two lines; merging
    // them would rewrite the method.
    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [
            ['ingredient_id' => (string) $oil->getKey(), 'quantity' => 50, 'unit_id' => $this->grams, 'comment' => 'marinade'],
            ['ingredient_id' => (string) $oil->getKey(), 'quantity' => 20, 'unit_id' => $this->grams, 'comment' => 'finish'],
        ],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.lines.0.line_number', 1)
        ->assertJsonPath('data.lines.1.line_number', 2)
        ->assertJsonPath('data.lines.1.comment', 'finish');

    // ...and the roll-up still says sesame once.
    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonCount(1, 'data.allergens');
});

it('demands exactly one primary output, and accepts none', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);
    $a = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Sauce Base', 'sesame');
    $b = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Sauce Trim', 'sesame');

    $url = "/api/v1/catalogue/recipes/{$recipeId}/versions/1/outputs";

    $two = [
        ['ingredient_id' => (string) $a->getKey(), 'output_quantity' => 900, 'unit_id' => $this->grams, 'is_primary' => true],
        ['ingredient_id' => (string) $b->getKey(), 'output_quantity' => 100, 'unit_id' => $this->grams, 'is_primary' => true],
    ];

    $this->putJson($url, ['outputs' => $two], $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    $none = [
        ['ingredient_id' => (string) $a->getKey(), 'output_quantity' => 900, 'unit_id' => $this->grams],
        ['ingredient_id' => (string) $b->getKey(), 'output_quantity' => 100, 'unit_id' => $this->grams],
    ];

    $this->putJson($url, ['outputs' => $none], $this->headers + ['If-Match' => '"1"'])
        ->assertStatus(422);

    // An empty set is legitimate: a component whose yield nobody has measured.
    $this->putJson($url, ['outputs' => []], $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.outputs', []);

    $two[1]['is_primary'] = false;

    $this->putJson($url, ['outputs' => $two], $this->headers + ['If-Match' => '"2"'])
        ->assertOk()
        ->assertJsonCount(2, 'data.outputs')
        ->assertJsonPath('data.outputs.0.is_primary', true);

    // The same ingredient cannot be produced twice by one version.
    $this->putJson($url, ['outputs' => [
        ['ingredient_id' => (string) $a->getKey(), 'output_quantity' => 1, 'unit_id' => $this->grams, 'is_primary' => true],
        ['ingredient_id' => (string) $a->getKey(), 'output_quantity' => 2, 'unit_id' => $this->grams],
    ]], $this->headers + ['If-Match' => '"3"'])
        ->assertStatus(422);
});

it('serves a version without any cost field, because the cost surface is K1.3', function (): void {
    [$recipeId] = publishableRecipe($this->kitchen, $this->headers, $this->grams);

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    // The columns exist and the importer writes them; no K1.2 projection reads
    // them, and the leak test is what keeps that true.
    RecipeVersionLine::withoutTenancy()
        ->where('recipe_version_id', $version->getKey())
        ->update(['unit_cost_amount' => '3.900000', 'line_cost_amount' => '0.975000', 'cost_currency_code' => 'USD']);

    $body = $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", $this->headers)
        ->assertOk()
        ->getContent();

    expect($body)->not->toContain('unit_cost_amount')
        ->and($body)->not->toContain('line_cost_amount')
        ->and($body)->not->toContain('cost_currency_code')
        ->and($body)->not->toContain('3.900000');
});
