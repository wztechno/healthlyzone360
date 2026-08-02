<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Exceptions\MixedCostCurrency;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Services\CostComputation;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\Recipes\Tests\Fixtures\RecipeWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Recipe costing — the arithmetic, and what may be written down
|--------------------------------------------------------------------------
|
| Two claims run through this file, and every test is one of them.
|
| **The arithmetic is exact.** Every amount is asserted as a literal string,
| never as a float and never through a delta. `expect($total)->toBe('7.75')`
| would pass on a value that is really 7.749999999999999, and a cost model
| that is only right to within a rounding error is a cost model that disagrees
| with the invoice. Six decimal places, half-up, bcmath end to end.
|
| **An incomplete costing is a report, not a record.** A total that silently
| omits a line reads exactly like a total that did not, so the service returns
| the missing line numbers and writes nothing at all.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = RecipeWorld::kitchen('costing@recipes.test');
    $this->grams = RecipeWorld::unit();
    $this->kilograms = RecipeWorld::unit('kg');

    $this->actingAs($this->kitchen->user);

    // The service reads the acting user from the tenant context when it stamps
    // `created_by`, exactly as the middleware would have set it.
    app(TenantContext::class)->setOrganisation(
        (string) $this->kitchen->user->getKey(),
        (string) $this->kitchen->organisation->getKey(),
    );

    $this->costing = app(RecipeCostingService::class);
});

/**
 * A version with the given lines, built directly rather than over HTTP: these
 * tests are about the arithmetic, and routing a decimal through a JSON body
 * only adds a place for it to be reshaped before the sum happens.
 *
 * @param  list<array{quantity: string|null, unit_cost: string|null, currency?: string|null}>  $lines
 * @param  array<string, mixed>  $version
 */
function costedVersion(object $kitchen, string $unitId, array $lines, array $version = []): RecipeVersion
{
    $recipe = Recipe::factory()->create(['organisation_id' => $kitchen->organisation->getKey()]);

    $record = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $kitchen->organisation->getKey(),
    ] + $version);

    foreach ($lines as $index => $line) {
        RecipeVersionLine::factory()->create([
            'recipe_version_id' => $record->getKey(),
            'organisation_id' => $kitchen->organisation->getKey(),
            'ingredient_id' => RecipeWorld::mappedIngredient($kitchen->organisation, 'Input '.$index.' '.uniqid(), 'sesame')->getKey(),
            'line_number' => $index + 1,
            'quantity' => $line['quantity'],
            'unit_id' => $line['quantity'] === null ? null : $unitId,
            'unit_cost_amount' => $line['unit_cost'],
            'cost_currency_code' => array_key_exists('currency', $line) ? $line['currency'] : ($line['unit_cost'] === null ? null : 'USD'),
        ]);
    }

    return $record->refresh();
}

it('multiplies each line and sums them to the exact six-place total', function (): void {
    // 2.5 × 3.9 = 9.75 and 0.125 × 12.4 = 1.55. A float sum of these lands on
    // 11.299999999999999 often enough to matter.
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '2.5', 'unit_cost' => '3.9'],
        ['quantity' => '0.125', 'unit_cost' => '12.4'],
    ]);

    $computation = $this->costing->computeRecalculated($version);

    expect($computation->lineCosts)->toBe([1 => '9.750000', 2 => '1.550000'])
        ->and($computation->totalInputCostAmount)->toBe('11.300000')
        ->and($computation->currencyCode)->toBe('USD')
        ->and($computation->uncostedLineNumbers)->toBe([])
        ->and($computation->isComplete())->toBeTrue()
        ->and($computation->isPartial())->toBeFalse();
});

it('rounds a line cost half-up at the sixth place rather than truncating it', function (): void {
    // 0.0005 × 0.001 is exactly 0.0000005 — the half that decides the rule.
    // bcmath truncates, which would make this line free; rounding half-up
    // makes it a millionth, and a system that rounds every figure down is a
    // system whose totals never match the invoice.
    $up = costedVersion($this->kitchen, $this->grams, [['quantity' => '0.0005', 'unit_cost' => '0.001']]);

    // 0.9999 × 1.0001 = 0.99999999, which has to carry all the way across the
    // decimal point rather than stopping at 0.999999.
    $carry = costedVersion($this->kitchen, $this->grams, [['quantity' => '0.9999', 'unit_cost' => '1.0001']]);

    expect($this->costing->computeRecalculated($up)->totalInputCostAmount)->toBe('0.000001')
        ->and($this->costing->computeRecalculated($carry)->totalInputCostAmount)->toBe('1.000000');
});

it('costs what the column can hold, not what the client typed', function (): void {
    // `unit_cost_amount` is `decimal(18,6)`. A seventh place submitted by a
    // client does not survive the write, and the arithmetic must be done on
    // the stored value rather than on the request — otherwise a recomputation
    // tomorrow would disagree with the snapshot written today.
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '3', 'unit_cost' => '0.3333333']]);

    expect((string) RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->sole()->unit_cost_amount)
        ->toBe('0.333333')
        ->and($this->costing->computeRecalculated($version)->totalInputCostAmount)->toBe('0.999999');
});

it('divides the total by the yield quantity and by the piece count, and applies waste to both', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '4', 'unit_cost' => '2.5'],
    ], [
        'yield_quantity' => '2',
        'yield_unit_id' => $this->kilograms,
        'yield_piece_count' => 8,
        'waste_coefficient_percent' => '3.00',
    ]);

    $computation = $this->costing->computeRecalculated($version);

    // 10 / 2 = 5 per kilo; 10 / 8 = 1.25 per piece; +3 % on each.
    expect($computation->totalInputCostAmount)->toBe('10.000000')
        ->and($computation->costPerYieldUnitAmount)->toBe('5.000000')
        ->and($computation->yieldUnitId)->toBe($this->kilograms)
        ->and($computation->costPerPieceAmount)->toBe('1.250000')
        ->and($computation->costPerYieldUnitWithWasteAmount)->toBe('5.150000')
        ->and($computation->costPerPieceWithWasteAmount)->toBe('1.287500');
});

it('rounds a recurring division to six places rather than carrying a float', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '1', 'unit_cost' => '10'],
    ], [
        'yield_quantity' => '3',
        'yield_unit_id' => $this->kilograms,
        'yield_piece_count' => 7,
        'waste_coefficient_percent' => '3.00',
    ]);

    $computation = $this->costing->computeRecalculated($version);

    // 10/3 = 3.333333…, 10/7 = 1.428571…, and the waste multiplier is applied
    // to the *rounded* figure so the two published numbers stay consistent
    // with one another.
    expect($computation->costPerYieldUnitAmount)->toBe('3.333333')
        ->and($computation->costPerPieceAmount)->toBe('1.428571')
        ->and($computation->costPerYieldUnitWithWasteAmount)->toBe('3.433333')
        ->and($computation->costPerPieceWithWasteAmount)->toBe('1.471428');
});

it('omits a denominator the version does not state rather than inventing one', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '2', 'unit_cost' => '1.5']]);

    $computation = $this->costing->computeRecalculated($version);

    expect($computation->totalInputCostAmount)->toBe('3.000000')
        ->and($computation->costPerYieldUnitAmount)->toBeNull()
        ->and($computation->yieldUnitId)->toBeNull()
        ->and($computation->costPerPieceAmount)->toBeNull()
        ->and($computation->costPerYieldUnitWithWasteAmount)->toBeNull()
        ->and($computation->costPerPieceWithWasteAmount)->toBeNull();
});

it('needs both a yield quantity and a yield unit before it will state a per-unit cost', function (): void {
    // A unit with no amount is not a yield, and an amount with no unit is a
    // number. Either alone buys a denominator nobody can interpret.
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '2', 'unit_cost' => '1.5']], [
        'yield_quantity' => '2',
        'yield_unit_id' => null,
    ]);

    expect($this->costing->computeRecalculated($version)->costPerYieldUnitAmount)->toBeNull();
});

it('treats a zero unit cost as a real figure and not as a missing one', function (): void {
    // A donated or self-produced input costs nothing, and saying so is not the
    // same as saying nothing.
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '5', 'unit_cost' => '0'],
        ['quantity' => '2', 'unit_cost' => '1.5'],
    ]);

    $computation = $this->costing->computeRecalculated($version);

    expect($computation->lineCosts)->toBe([1 => '0.000000', 2 => '3.000000'])
        ->and($computation->uncostedLineNumbers)->toBe([])
        ->and($computation->isComplete())->toBeTrue();
});

it('names every line that could not be costed and refuses to call the result complete', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '2', 'unit_cost' => '1.5'],
        ['quantity' => '3', 'unit_cost' => null],

        // A price with no amount cannot be multiplied either. The master plan
        // phrases the rule as "every line with a quantity has a unit cost";
        // this is the wider reading, because a total that skipped this line
        // would understate the formulation by exactly the ingredient somebody
        // forgot to measure.
        ['quantity' => null, 'unit_cost' => '9.99'],
    ]);

    $computation = $this->costing->computeRecalculated($version);

    expect($computation->uncostedLineNumbers)->toBe([2, 3])
        ->and($computation->totalInputCostAmount)->toBe('3.000000')
        ->and($computation->isComplete())->toBeFalse()
        ->and($computation->isPartial())->toBeTrue();
});

it('refuses to write a snapshot from an incomplete computation', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '2', 'unit_cost' => '1.5'],
        ['quantity' => '3', 'unit_cost' => null],
    ]);

    $computation = $this->costing->computeRecalculated($version);

    expect(fn () => $this->costing->writeSnapshot($version, CostBasis::Recalculated, $computation))
        ->toThrow(RuntimeException::class, 'incomplete computation')
        ->and(RecipeCostSnapshot::withoutTenancy()->count())->toBe(0);
});

it('refuses to cost a version whose lines are in two currencies, and names them', function (): void {
    // Reachable only through the importer, which stores what a sheet said —
    // the lines endpoint rejects a second currency at write time. Guarded here
    // anyway, because "unreachable" is a property of today's write paths and
    // this is a property of the arithmetic.
    $version = costedVersion($this->kitchen, $this->grams, [
        ['quantity' => '2', 'unit_cost' => '1.5', 'currency' => 'USD'],
        ['quantity' => '3', 'unit_cost' => '2.0', 'currency' => 'EUR'],
    ]);

    try {
        $this->costing->computeRecalculated($version);
        $this->fail('A version in two currencies was costed.');
    } catch (MixedCostCurrency $exception) {
        expect($exception->details['currencies'])->toEqualCanonicalizing(['USD', 'EUR'])
            ->and($exception->details['line_numbers'])->toBe([1, 2])
            ->and($exception->errorCode->value)->toBe('validation.failed');
    }
});

it('reports no currency at all when nothing is costed', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '2', 'unit_cost' => null]]);

    $computation = $this->costing->computeRecalculated($version);

    expect($computation->currencyCode)->toBeNull()
        ->and($computation->isComplete())->toBeFalse()

        // Not "partial": nothing was costed, so there is no half-finished
        // total for anybody to misread.
        ->and($computation->isPartial())->toBeFalse();
});

it('appends a snapshot carrying every computed figure and audits it without any amounts', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '4', 'unit_cost' => '2.5']], [
        'yield_quantity' => '2',
        'yield_unit_id' => $this->kilograms,
        'yield_piece_count' => 8,
    ]);

    $snapshot = $this->costing->writeSnapshot(
        $version,
        CostBasis::Recalculated,
        $this->costing->computeRecalculated($version),
    );

    expect((string) $snapshot->total_input_cost_amount)->toBe('10.000000')
        ->and((string) $snapshot->cost_per_yield_unit_amount)->toBe('5.000000')
        ->and((string) $snapshot->cost_per_piece_with_waste_amount)->toBe('1.287500')
        ->and($snapshot->currency_code)->toBe('USD')
        ->and($snapshot->basis)->toBe(CostBasis::Recalculated)
        ->and($snapshot->basis_mismatch)->toBeFalse()
        ->and($snapshot->created_by)->toBe((string) $this->kitchen->user->getKey())
        ->and($snapshot->updated_at ?? null)->toBeNull();

    $audit = AuditLog::query()->where('action', 'catalogue.recipe_cost_snapshot_created')->sole();

    /** @var array<string, mixed> $metadata */
    $metadata = $audit->metadata;

    expect($metadata['basis'])->toBe('recalculated')
        ->and($metadata['costed_line_count'])->toBe(1)

        // The audit trail is readable with `audit.view_organisation`, which is
        // not the cost permission. One amount here would route around the
        // whole split.
        ->and(json_encode($metadata, JSON_THROW_ON_ERROR))->not->toContain('10.000000')
        ->and(json_encode($metadata, JSON_THROW_ON_ERROR))->not->toContain('5.000000');
});

it('stores a source sheet verbatim on the as-recorded basis, errors included', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '4', 'unit_cost' => '2.5']], [
        'yield_quantity' => '2',
        'yield_unit_id' => $this->kilograms,
    ]);

    // The sheet says 11.00 where the lines say 10.00. That disagreement is
    // evidence, and correcting it on import would destroy the evidence that it
    // needs correcting.
    $snapshot = $this->costing->writeSnapshot(
        $version,
        CostBasis::AsRecorded,
        CostComputation::asRecorded(
            currencyCode: 'USD',
            totalInputCostAmount: '11.000000',
            wasteCoefficientPercent: '3.00',
            costPerYieldUnitAmount: '5.500000',
            yieldUnitId: $this->kilograms,
        ),
        sourceLabel: 'Cost per kg',
    );

    expect((string) $snapshot->total_input_cost_amount)->toBe('11.000000')
        ->and($snapshot->basis)->toBe(CostBasis::AsRecorded)
        ->and($snapshot->source_label)->toBe('Cost per kg')
        ->and($snapshot->basis_mismatch)->toBeFalse()
        ->and((string) $this->costing->computeRecalculated($version)->totalInputCostAmount)->toBe('10.000000');
});

it('flags a source label that claims a basis the version cannot support', function (string $label, string $yieldKind, bool $expected): void {
    // Appendix D findings #1 and #2: the sheet labels are unreliable, so the
    // basis is derived from the yield fields and the label is only ever
    // compared against it. The yield is named rather than passed as data
    // because a measurement-unit identifier only exists once the seeders have
    // run, and a dataset is resolved before any of that happens.
    $yield = match ($yieldKind) {
        'measured' => ['yield_quantity' => '2', 'yield_unit_id' => $this->kilograms],
        'pieces' => ['yield_piece_count' => 8],
        'both' => ['yield_quantity' => '2', 'yield_unit_id' => $this->kilograms, 'yield_piece_count' => 8],
    };

    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '4', 'unit_cost' => '2.5']], $yield);

    $snapshot = $this->costing->writeSnapshot(
        $version,
        CostBasis::AsRecorded,
        $this->costing->computeRecalculated($version),
        sourceLabel: $label,
    );

    expect($snapshot->basis_mismatch)->toBe($expected);
})->with([
    'per-kg label on a version with a measured yield' => ['Cost per kg', 'measured', false],
    'per-kg label on a version that only counts pieces' => ['Cost per kg', 'pieces', true],
    'per-piece label on a version that only measures mass' => ['Cost per piece', 'measured', true],
    'per-piece label on a version that counts pieces' => ['Cost / piece', 'pieces', false],
    'a label claiming both at once' => ['Cost per kg per piece', 'both', true],

    // Silence beats a flag nobody can act on: a mismatch raised on wording the
    // matcher does not understand teaches reviewers to ignore the flag.
    'an unclassifiable label raises nothing' => ['U.P. total', 'pieces', false],
    'no label at all raises nothing' => ['', 'pieces', false],
]);

it('publishes with a snapshot and flips completeness when every line is costed', function (): void {
    $ingredient = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $headers = RecipeWorld::headers($this->kitchen);

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Costed Sauce'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->patchJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1", [
        'yield_quantity' => '2', 'yield_unit_id' => $this->kilograms, 'yield_piece_count' => 8,
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [[
            'ingredient_id' => (string) $ingredient->getKey(),
            'quantity' => 4,
            'unit_id' => $this->grams,
            'unit_cost_amount' => '2.5',
            'cost_currency_code' => 'USD',
        ]],
    ], $headers + ['If-Match' => '"1"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $headers + ['If-Match' => '"2"'])
        ->assertOk()
        ->assertJsonPath('data.version.completeness', 'costed');

    $version = RecipeVersion::withoutTenancy()->where('recipe_id', $recipeId)->sole();
    $snapshot = RecipeCostSnapshot::withoutTenancy()->where('recipe_version_id', $version->getKey())->sole();

    expect($version->completeness)->toBe(RecipeCompleteness::Costed)
        ->and($snapshot->basis)->toBe(CostBasis::Recalculated)
        ->and((string) $snapshot->total_input_cost_amount)->toBe('10.000000')
        ->and((string) $snapshot->cost_per_yield_unit_amount)->toBe('5.000000')

        // The snapshot is written inside the publishing transaction, so it
        // carries the publication's own instant rather than a later one.
        ->and($snapshot->calculated_at->toIso8601String())->toBe($version->published_at?->toIso8601String());

    $audit = AuditLog::query()->where('action', 'catalogue.recipe_version_published')->sole();

    /** @var array<string, mixed> $metadata */
    $metadata = $audit->metadata;

    expect($metadata['cost_snapshot_written'])->toBeTrue()
        ->and($metadata['completeness'])->toBe('costed');
});

it('publishes without a snapshot and stays indicative when the costs are half-entered', function (): void {
    // Costing is commercial and allergens are food-safety. Holding a correct
    // label hostage to a missing unit price would teach a kitchen to publish
    // first and fix labels later.
    $first = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Tahini', 'sesame');
    $second = RecipeWorld::mappedIngredient($this->kitchen->organisation, 'Lemon', 'sulphites');
    $headers = RecipeWorld::headers($this->kitchen);

    $recipeId = $this->postJson('/api/v1/catalogue/recipes', ['name_en' => 'Half Priced Sauce'], $headers)
        ->assertCreated()
        ->json('data.recipe.id');

    $this->putJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/lines", [
        'lines' => [
            ['ingredient_id' => (string) $first->getKey(), 'quantity' => 4, 'unit_id' => $this->grams, 'unit_cost_amount' => '2.5', 'cost_currency_code' => 'USD'],
            ['ingredient_id' => (string) $second->getKey(), 'quantity' => 1, 'unit_id' => $this->grams],
        ],
    ], $headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson("/api/v1/catalogue/recipes/{$recipeId}/versions/1/publish", [],
        $headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.version.status', 'published')
        ->assertJsonPath('data.version.completeness', 'indicative');

    expect(RecipeCostSnapshot::withoutTenancy()->count())->toBe(0);

    $audit = AuditLog::query()->where('action', 'catalogue.recipe_version_published')->sole();

    /** @var array<string, mixed> $metadata */
    $metadata = $audit->metadata;

    expect($metadata['cost_snapshot_written'])->toBeFalse();
});

it('never lets a snapshot be updated or deleted through the model either', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '4', 'unit_cost' => '2.5']]);

    $snapshot = $this->costing->writeSnapshot(
        $version,
        CostBasis::Recalculated,
        $this->costing->computeRecalculated($version),
    );

    // There is no updated_at column, so an Eloquent save that touched
    // timestamps would fail loudly rather than silently rewriting history.
    expect($snapshot->timestamps)->toBeTrue()
        ->and(RecipeCostSnapshot::UPDATED_AT)->toBeNull()
        ->and($snapshot->getAttributes())->not->toHaveKey('updated_at');
});

it('reads back the newest snapshot of each basis independently', function (): void {
    $version = costedVersion($this->kitchen, $this->grams, [['quantity' => '4', 'unit_cost' => '2.5']]);

    $older = RecipeCostSnapshot::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'calculated_at' => now()->subDay(),
        'total_input_cost_amount' => '1.000000',
    ]);

    $newer = RecipeCostSnapshot::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'calculated_at' => now(),
        'total_input_cost_amount' => '2.000000',
    ]);

    $recorded = RecipeCostSnapshot::factory()->asRecorded()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->kitchen->organisation->getKey(),
        'calculated_at' => now()->subWeek(),
        'total_input_cost_amount' => '3.000000',
    ]);

    expect(RecipeCostSnapshot::latestFor((string) $version->getKey(), CostBasis::Recalculated)?->getKey())->toBe($newer->getKey())
        ->and(RecipeCostSnapshot::latestFor((string) $version->getKey(), CostBasis::AsRecorded)?->getKey())->toBe($recorded->getKey())
        ->and($older->getKey())->not->toBe($newer->getKey());
});
