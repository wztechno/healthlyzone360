<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The cost surface — who may see it, and where it must never appear
|--------------------------------------------------------------------------
|
| `recipe.view_costs_organisation` is a separate permission from
| `recipe.view_organisation` for one reason (appendix C): a line cook reading
| the method to make the dish must not thereby read the margin on it. That is
| a claim about two things, and this file tests both.
|
| The endpoints behind the cost permission serve costs. **Every other recipe
| endpoint serves none**, and the sweep at the bottom of this file is what
| makes that a mechanism rather than a habit — it walks the whole non-cost
| surface and fails on any key that looks like money, so a presenter that
| gains a cost field fails here before it reaches a review.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    // The chef shape: manages recipes and sees costs.
    $this->kitchen = RecipeWorld::kitchen('chef@sheets.test');
    $this->headers = RecipeWorld::headers($this->kitchen);
    $this->grams = RecipeWorld::unit();
    $this->kilograms = RecipeWorld::unit('kg');

    $this->actingAs($this->kitchen->user);
});

/**
 * A recipe with one costed line, returned as `[recipeId, versionId]`. The
 * version yields two kilos in eight pieces, so both denominators exist.
 */
function costedSheet(object $kitchen, array $headers, string $grams, string $kilograms, string $name = 'Hummus'): array
{
    $ingredient = RecipeWorld::mappedIngredient($kitchen->organisation, 'Tahini '.uniqid(), 'sesame');

    $recipeId = test()->postJson('/api/v1/catalogue/recipes', ['name_en' => $name], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    test()->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '2', 'yield_unit_id' => $kilograms, 'yield_piece_count' => 8,
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    test()->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 4,
            'unit_id' => $grams,
            'unit_cost_amount' => '2.5',
            'cost_currency_code' => 'usd',
        ]],
    ], $headers + ['If-Match' => '"1"'])->assertOk();

    $versionId = (string) RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole()->getKey();

    return [$recipeId, $versionId];
}

/**
 * Every key in a decoded response body, however deeply nested.
 *
 * @param  array<array-key, mixed>  $payload
 * @return list<string>
 */
function responseKeys(array $payload): array
{
    $keys = [];

    foreach ($payload as $key => $value) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        if (is_array($value)) {
            $keys = [...$keys, ...responseKeys($value)];
        }
    }

    return $keys;
}

/**
 * The keys of a response that are cost figures, which no recipe endpoint may serve.
 *
 * `b2b_price_amount` and `b2c_price_amount` are excluded, and the exclusion is the claim rather
 * than a hole punched to make a sweep pass. They are **list prices** — the B2C figure is printed
 * on a menu and the B2B one is quoted to the buyer it names — so they say what the kitchen
 * charges, never what it paid. Nothing here can be run backwards into a cost or a margin while
 * the cost half stays withheld, which is what the rest of this sweep enforces. `RecipeVersion`
 * makes the same argument where it declines to classify the pair Confidential, and `ingredients`
 * treats its own two price columns identically. Every other `cost` / `margin` / `amount` key
 * still fails here, including one a presenter grows tomorrow.
 *
 * @param  array<array-key, mixed>  $payload
 * @return list<string>
 */
function costKeys(array $payload): array
{
    return array_values(array_filter(
        array_unique(responseKeys($payload)),
        static fn (string $key): bool => preg_match('/cost|margin|amount/i', $key) === 1
            && preg_match('/^b2[bc]_price_amount$/', $key) !== 1,
    ));
}

// ── Writing costs in ────────────────────────────────────────────────────────

it('accepts a unit cost on a line, normalises the currency and derives the line total', function (): void {
    [$recipeId, $versionId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $line = RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $versionId)->sole();

    expect((string) $line->unit_cost_amount)->toBe('2.500000')

        // Derived, never accepted: 4 × 2.5. A client that could post a line
        // total could post one that disagrees with its own inputs.
        ->and((string) $line->line_cost_amount)->toBe('10.000000')

        // Lower case in, canonical out. A currency is an identity, not a
        // spelling.
        ->and($line->cost_currency_code)->toBe('USD')
        ->and($recipeId)->not->toBeEmpty();
});

it('refuses a cost without a currency, a currency without a cost, and a currency nobody has heard of', function (array $line, string $field): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Broken Costs'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $response = $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 2, 'unit_id' => $this->grams] + $line],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // The field key is the dotted path itself — `lines.0.cost_currency_code`
    // is one key, not three levels — so it is read rather than walked.
    /** @var array<string, list<string>> $fields */
    $fields = $response->json('error.details.fields');

    expect($fields)->toHaveKey("lines.0.{$field}")
        ->and($fields["lines.0.{$field}"][0])->toBeString();
})->with([
    'an amount with no currency' => [['unit_cost_amount' => '2.5'], 'cost_currency_code'],
    'a currency with no amount' => [['cost_currency_code' => 'USD'], 'unit_cost_amount'],
    'a currency the platform does not know' => [['unit_cost_amount' => '2.5', 'cost_currency_code' => 'ZZZ'], 'cost_currency_code'],
]);

it('refuses to put two currencies on one formulation', function (): void {
    // There is no exchange rate in this system and §4.4 forbids adding one, so
    // the state is refused at the door rather than discovered at the total.
    $first = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $second = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon', 'sulphites');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Two Currencies'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [
            ['ingredient_id' => (string) $first->getKey(), 'quantity' => 2, 'unit_id' => $this->grams, 'unit_cost_amount' => '2.5', 'cost_currency_code' => 'USD'],
            ['ingredient_id' => (string) $second->getKey(), 'quantity' => 1, 'unit_id' => $this->grams, 'unit_cost_amount' => '1.0', 'cost_currency_code' => 'EUR'],
        ],
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.currencies', ['USD', 'EUR']);
});

it('refuses a blind cost write from a manager who cannot see costs', function (): void {
    $blind = RecipeWorld::kitchen('blind-manager@sheets.test', [
        'catalogue.view_organisation',
        'recipe.view_organisation',
        'recipe.manage_organisation',
    ]);

    $this->actingAs($blind->user);
    $headers = RecipeWorld::headers($blind);
    $ingredient = RecipeWorld::mappedIngredient($blind->organisation, 'Tahini', 'sesame');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Blind Costing'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 2,
            'unit_id' => $this->grams,
            'unit_cost_amount' => '2.5',
            'cost_currency_code' => 'USD',
        ]],
    ], $headers + ['If-Match' => '"0"'])
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'recipe.view_costs_organisation');

    // And nothing was written: somebody who cannot check the number they are
    // typing is how a decimal point moves three places.
    expect(RecipeVersionLine::withoutTenancy()->whereNotNull('unit_cost_amount')->count())->toBe(0);
});

it('refuses to let a manager who cannot see costs erase them by replacing the lines', function (): void {
    // The half people miss. Lines arrive as a complete set, so a replacement
    // that omits the cost fields destroys whatever was there — and positional
    // line identity means it cannot be safely put back.
    //
    // A whole kitchen without the cost permission, rather than one with the
    // grant revoked mid-test: the permission decision is cached per user ×
    // organisation and busted by a version counter, so a raw grant delete
    // would leave the test asserting against a stale cache rather than
    // against the rule.
    $blind = RecipeWorld::kitchen('erasing-manager@sheets.test', [
        'catalogue.view_organisation',
        'recipe.view_organisation',
        'recipe.manage_organisation',
    ]);

    $this->actingAs($blind->user);
    $headers = RecipeWorld::headers($blind);

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Already Costed'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();

    // The costs arrive the way the importer will bring them: written to the
    // table, not through an endpoint this caller could have used.
    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $blind->organisation->getKey(),
        'ingredient_id' => RecipeWorld::mappedIngredient($blind->organisation, 'Tahini', 'sesame')->getKey(),
        'line_number' => 1,
        'unit_cost_amount' => '2.500000',
        'cost_currency_code' => 'USD',
    ]);

    $ingredient = RecipeWorld::mappedIngredient($blind->organisation, 'Chickpea', 'sesame');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 2, 'unit_id' => $this->grams]],
    ], $headers + ['If-Match' => '"0"'])
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'recipe.view_costs_organisation');

    expect(RecipeVersionLine::withoutTenancy()->whereNotNull('unit_cost_amount')->count())->toBe(1);
});

// ── Reading the technical sheet ─────────────────────────────────────────────

it('serves the technical sheet to a caller who may see costs, and audits the read', function (): void {
    [$recipeId, $versionId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", ['basis' => 'recalculated'], $this->headers)
        ->assertCreated();

    $response = $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.completeness', 'indicative')
        ->assertJsonPath('data.currency_code', 'USD')
        ->assertJsonPath('data.currency_conflict', false)
        ->assertJsonPath('data.uncosted_line_numbers', [])
        ->assertJsonPath('data.lines.0.unit_cost_amount', '2.500000')
        ->assertJsonPath('data.lines.0.line_cost_amount', '10.000000')
        ->assertJsonPath('data.lines.0.cost_currency_code', 'USD')
        ->assertJsonPath('data.snapshots.recalculated.total_input_cost_amount', '10.000000')
        ->assertJsonPath('data.snapshots.recalculated.cost_per_yield_unit_amount', '5.000000')
        ->assertJsonPath('data.snapshots.recalculated.cost_per_piece_amount', '1.250000')
        ->assertJsonPath('data.snapshots.recalculated.cost_per_piece_with_waste_amount', '1.287500')

        // Both bases are always present as keys, so a client never has to
        // guess whether a missing key means "none" or "not asked for".
        ->assertJsonPath('data.snapshots.as_recorded', null);

    $audit = AuditLog::query()->where('action', 'catalogue.technical_sheet_viewed')->sole();

    expect($audit->purpose_of_use)->toBe('organisation_administration')
        ->and($audit->subject_type)->toBe('recipe_version')
        ->and($audit->subject_id)->toBe($versionId)
        ->and($audit->actor_user_id)->toBe((string) $this->kitchen->user->getKey());

    /** @var array<string, mixed> $metadata */
    $metadata = $audit->metadata;

    expect($metadata['classification'])->toBe('confidential')
        ->and($metadata['line_count'])->toBe(1)
        ->and($metadata['uncosted_line_count'])->toBe(0)

        // An audit row is readable with `audit.view_organisation`, which is
        // not the cost permission. A single amount here would route around
        // the whole split this slice exists to build.
        ->and(json_encode($metadata, JSON_THROW_ON_ERROR))->not->toContain('10.000000')
        ->and(json_encode($metadata, JSON_THROW_ON_ERROR))->not->toContain('2.500000')
        ->and($response->json('data.snapshots.recalculated.basis'))->toBe('recalculated');
});

it('labels both bases when both exist', function (): void {
    [$recipeId, $versionId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", ['basis' => 'recalculated'], $this->headers)
        ->assertCreated();

    // What the importer will write: the sheet's own total, its own wording,
    // and the flag that says the wording does not survive the yield.
    RecipeCostSnapshot::factory()->asRecorded('Cost per piece')->create([
        'recipe_version_id' => $versionId,
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'total_input_cost_amount' => '11.000000',
    ]);

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.snapshots.recalculated.total_input_cost_amount', '10.000000')
        ->assertJsonPath('data.snapshots.recalculated.source_label', null)
        ->assertJsonPath('data.snapshots.as_recorded.total_input_cost_amount', '11.000000')
        ->assertJsonPath('data.snapshots.as_recorded.source_label', 'Cost per piece')
        ->assertJsonPath('data.snapshots.as_recorded.basis_mismatch', true);
});

it('reports the lines nobody has priced rather than pretending the total is whole', function (): void {
    $first = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $second = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon', 'sulphites');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Half Priced'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [
            ['ingredient_id' => (string) $first->getKey(), 'quantity' => 4, 'unit_id' => $this->grams, 'unit_cost_amount' => '2.5', 'cost_currency_code' => 'USD'],
            ['ingredient_id' => (string) $second->getKey(), 'quantity' => 1, 'unit_id' => $this->grams],
        ],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $this->headers)
        ->assertOk()
        ->assertJsonPath('data.uncosted_line_numbers', [2])
        ->assertJsonPath('data.snapshots.recalculated', null)
        ->assertJsonPath('data.lines.1.unit_cost_amount', null);
});

it('refuses the whole cost surface to a caller who may read the recipe but not its costs', function (string $path, string $method): void {
    // The kitchen_staff shape: the method and the allergen label, and no money.
    $staff = RecipeWorld::kitchen('line-cook@sheets.test', [
        'catalogue.view_organisation',
        'recipe.view_organisation',
        'recipe.manage_organisation',
    ]);

    $this->actingAs($staff->user);
    $headers = RecipeWorld::headers($staff);
    $ingredient = RecipeWorld::mappedIngredient($staff->organisation, 'Tahini', 'sesame');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Off Limits'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [['ingredient_id' => (string) $ingredient->getKey(), 'quantity' => 2, 'unit_id' => $this->grams]],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    // The recipe itself stays readable — that is the point of the split.
    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", $headers)->assertOk();

    $this->json($method, "/api/v1/catalogue/recipes/{$recipeId}/versions/1/{$path}", ['basis' => 'recalculated'], $headers)
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'recipe.view_costs_organisation');
})->with([
    'the technical sheet' => ['technical-sheet', 'GET'],
    'the snapshot ledger' => ['cost-snapshots', 'GET'],
    'writing a snapshot' => ['cost-snapshots', 'POST'],
]);

it('writes no audit access event when the cost permission refused the read', function (): void {
    $staff = RecipeWorld::kitchen('no-audit@sheets.test', ['recipe.view_organisation', 'recipe.manage_organisation', 'catalogue.view_organisation']);
    $this->actingAs($staff->user);
    $headers = RecipeWorld::headers($staff);

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Denied'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", $headers)->assertStatus(403);

    // Recording an access that never happened corrupts the trail; the denial
    // has its own failure path already.
    expect(AuditLog::query()->where('action', 'catalogue.technical_sheet_viewed')->count())->toBe(0);
});

it('shows one kitchen nothing of another kitchens costs', function (): void {
    [$recipeId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $rival = RecipeWorld::kitchen('rival@sheets.test');
    $this->actingAs($rival->user);

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/technical-sheet", RecipeWorld::headers($rival))
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", RecipeWorld::headers($rival))
        ->assertStatus(404);
});

// ── The snapshot ledger ─────────────────────────────────────────────────────

it('appends a snapshot on request without promoting the version to costed', function (): void {
    // Only publication flips `completeness`. Letting an ad-hoc recalculation
    // promote a draft would make the field mean "somebody once pressed a
    // button" instead of "this is what was published".
    [$recipeId, $versionId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", ['basis' => 'recalculated'], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.snapshot.basis', 'recalculated')
        ->assertJsonPath('data.snapshot.total_input_cost_amount', '10.000000')
        ->assertJsonPath('data.snapshot.currency_code', 'USD')
        ->assertJsonPath('data.snapshot.basis_mismatch', false);

    expect(RecipeVersion::withoutTenancy()->whereKey($versionId)->sole()->completeness)
        ->toBe(RecipeCompleteness::Indicative)
        ->and(RecipeCostSnapshot::withoutTenancy()->where('recipe_version_id', $versionId)->count())->toBe(1);
});

it('refuses an as-recorded snapshot over the API: only the importer holds a source sheet', function (): void {
    [$recipeId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", ['basis' => 'as_recorded'], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(RecipeCostSnapshot::withoutTenancy()->count())->toBe(0);
});

it('refuses to snapshot a version that is not fully costed, and names the lines', function (): void {
    $first = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $second = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon', 'sulphites');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Incomplete'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [
            ['ingredient_id' => (string) $first->getKey(), 'quantity' => 4, 'unit_id' => $this->grams, 'unit_cost_amount' => '2.5', 'cost_currency_code' => 'USD'],
            ['ingredient_id' => (string) $second->getKey(), 'quantity' => 1, 'unit_id' => $this->grams],
        ],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", ['basis' => 'recalculated'], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.uncosted_line_numbers', [2])
        ->assertJsonPath('error.details.partial', true);

    expect(RecipeCostSnapshot::withoutTenancy()->count())->toBe(0);
});

it('refuses to cost a retired version', function (): void {
    [$recipeId, $versionId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [], $this->headers + ['If-Match' => '"2"'])->assertOk();
    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/retire", [], $this->headers + ['If-Match' => '"3"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots", ['basis' => 'recalculated'], $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.status', 'retired');

    // Publication wrote one; the refusal added none.
    expect(RecipeCostSnapshot::withoutTenancy()->where('recipe_version_id', $versionId)->count())->toBe(1);
});

it('walks the snapshot ledger newest first, one page at a time', function (): void {
    [$recipeId, $versionId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $ordered = [];

    foreach (['1.000000', '2.000000', '3.000000'] as $index => $total) {
        $ordered[] = (string) RecipeCostSnapshot::factory()->create([
            'recipe_version_id' => $versionId,
            'organisation_id' => $this->kitchen->organisation->getKey(),
            'total_input_cost_amount' => $total,
            'created_at' => now()->addSeconds($index),
            'calculated_at' => now()->addSeconds($index),
        ])->getKey();
    }

    $first = $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots?limit=2", $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.count', 2)
        ->assertJsonPath('meta.has_more', true)
        ->assertJsonPath('data.0.total_input_cost_amount', '3.000000')
        ->assertJsonPath('data.1.total_input_cost_amount', '2.000000');

    $this->getJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/cost-snapshots?limit=2&cursor=".$first->json('meta.next_cursor'), $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.has_more', false)
        ->assertJsonPath('meta.next_cursor', null)
        ->assertJsonPath('data.0.total_input_cost_amount', '1.000000')
        ->assertJsonCount(1, 'data');

    expect($ordered)->toHaveCount(3);
});

// ── The leak sweep ──────────────────────────────────────────────────────────

it('serialises no cost on any recipe endpoint outside the cost permission', function (string $path): void {
    [$recipeId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $body = $this->getJson(str_replace('{recipe}', (string) $recipeId, $path), $this->headers)
        ->assertOk()
        ->json();

    // `costKeys()` is a key sweep rather than a list of expected fields: a
    // presenter that gains `unit_cost_amount` tomorrow fails here without
    // anybody remembering to update a list. The caller in this test *does*
    // hold the cost permission, which is the point — these endpoints must
    // serve no costs to anyone, not merely to the unprivileged.
    $offending = costKeys($body);

    expect($offending)->toBe([]);
})->with([
    'the recipe book' => ['/api/v1/catalogue/recipes'],
    'one recipe' => ['/api/v1/catalogue/recipes/{recipe}'],
    'the version history' => ['/api/v1/catalogue/recipes/{recipe}/versions'],
    'one whole version' => ['/api/v1/catalogue/recipes/{recipe}/versions/1'],
    'the frozen allergen label' => ['/api/v1/catalogue/recipes/{recipe}/versions/1/allergens'],
]);

it('returns no cost from the lines endpoint even to a caller who just wrote one', function (): void {
    // The line replacement echoes the new set back. It is guarded by
    // `recipe.manage_organisation`, not by the cost permission, so its
    // response must stay cost-free whoever called it.
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Echoed'], $this->headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $body = $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 2,
            'unit_id' => $this->grams,
            'unit_cost_amount' => '4.25',
            'cost_currency_code' => 'USD',
        ]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk()->json();

    $offending = costKeys($body);

    expect($offending)->toBe([])
        ->and(json_encode($body, JSON_THROW_ON_ERROR))->not->toContain('4.25')

        // It really was persisted — the response is quiet, not the database.
        ->and((string) RecipeVersionLine::withoutTenancy()->whereNotNull('unit_cost_amount')->sole()->unit_cost_amount)->toBe('4.250000');
});

it('keeps the cost snapshot out of the publish response as well', function (): void {
    [$recipeId] = costedSheet($this->kitchen, $this->headers, $this->grams, $this->kilograms);

    $body = $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [], $this->headers + ['If-Match' => '"2"'])
        ->assertOk()
        ->json();

    $offending = costKeys($body);

    // Publication wrote a snapshot; the response says so only through
    // `completeness`, which is a state and not a figure.
    expect($offending)->toBe([])
        ->and($body['data']['version']['completeness'])->toBe('costed')
        ->and(RecipeCostSnapshot::withoutTenancy()->where('basis', CostBasis::Recalculated->value)->count())->toBe(1);
});
