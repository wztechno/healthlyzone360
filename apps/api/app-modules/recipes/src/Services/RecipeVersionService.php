<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Closure;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Exceptions\AllergenUnmapped;
use Healthy360\Recipes\Exceptions\PublishBlocked;
use Healthy360\Recipes\Exceptions\StaleLockVersion;
use Healthy360\Recipes\Exceptions\VersionImmutable;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Everything that happens to the *content* of a recipe version: drafting,
 * replacing its lines, outputs and steps, publishing it and retiring it.
 *
 * Three rules run through all of it.
 *
 * 1. **Published means frozen** (master plan v2 §4.7). Every content write
 *    goes through `assertEditable()`, and a published or retired version is
 *    refused with `catalogue.version_immutable` rather than a conflict: the
 *    caller has not lost a race, and no amount of reloading will make the
 *    resource writable. A change is a new draft version.
 * 2. **Set-replace, not merge.** Lines, outputs and steps arrive as complete
 *    statements over PUT. On a formulation the difference between "I removed
 *    the sesame line" and "I forgot to send the sesame line" is the whole
 *    point, and a PATCH surface makes those two requests identical.
 * 3. **Publication is a gate, not a status field.** `publish()` evaluates
 *    readiness across the lines, their ingredients and those ingredients'
 *    allergen determinations, and only then writes the frozen label. There is
 *    no stored "publishable" flag to fall out of step with the data.
 */
final readonly class RecipeVersionService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private AllergenRollupService $rollup,
        private RecipeCostingService $costing,
        private CostVisibility $costVisibility,
    ) {}

    /**
     * The next draft version of a recipe, optionally copied from an existing
     * one.
     *
     * Copying is the normal path: a new version almost always starts as
     * "last one, with a change", and making a chef re-key twenty lines to
     * correct one of them is how a kitchen ends up editing published versions
     * in the database instead. Lines, outputs, steps and **declared** allergen
     * rows are carried over; derived rows are not, because they are a
     * conclusion about a published state and this version has none yet.
     *
     * @throws ApiException
     */
    public function newDraft(Recipe $recipe, ?RecipeVersion $copyFrom = null): RecipeVersion
    {
        if ($copyFrom !== null && $copyFrom->recipe_id !== (string) $recipe->getKey()) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return DB::transaction(function () use ($recipe, $copyFrom): RecipeVersion {
            $next = (int) (RecipeVersion::withoutTenancy()
                ->where('recipe_id', $recipe->getKey())
                ->max('version_number') ?? 0) + 1;

            $version = new RecipeVersion;
            $version->recipe_id = (string) $recipe->getKey();
            $version->organisation_id = $recipe->organisation_id;
            $version->version_number = $next;
            $version->status = RecipeVersionStatus::Draft;
            $version->completeness = $copyFrom === null ? RecipeCompleteness::Indicative : $copyFrom->completeness;
            $version->yield_quantity = $copyFrom?->yield_quantity;
            $version->yield_unit_id = $copyFrom?->yield_unit_id;
            $version->yield_piece_count = $copyFrom?->yield_piece_count;
            $version->input_quantity_total = $copyFrom?->input_quantity_total;
            $version->waste_coefficient_percent = $copyFrom === null ? '3.00' : $copyFrom->waste_coefficient_percent;
            $version->derivation_state = DerivationState::Stale;
            $version->notes = $copyFrom?->notes;
            $version->lock_version = 0;
            $version->created_by = $this->context->userId();
            $version->updated_by = $this->context->userId();
            $version->save();

            if ($copyFrom !== null) {
                $this->copyContent($copyFrom, $version);
            }

            $this->audit->record(
                'catalogue.recipe_version_created',
                actorUserId: $this->context->userId(),
                subjectType: 'recipe_version',
                subjectId: (string) $version->getKey(),
                metadata: [
                    'recipe_id' => (string) $recipe->getKey(),
                    'version_number' => $next,
                    'origin' => $copyFrom === null ? 'blank' : 'copied',
                    'copied_from_version_number' => $copyFrom?->version_number,
                ],
            );

            return $version;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(RecipeVersion $version, array $attributes, int $expectedLockVersion): RecipeVersion
    {
        $this->assertEditable($version);

        $changes = [];

        foreach (['completeness', 'yield_quantity', 'yield_unit_id', 'yield_piece_count', 'input_quantity_total', 'waste_coefficient_percent', 'notes'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);
            }

            if ($value === '' && $field === 'notes') {
                $value = null;
            }

            $changes[$field] = $value;
        }

        if (isset($changes['yield_unit_id']) && is_string($changes['yield_unit_id'])) {
            $this->assertUnitExists($changes['yield_unit_id'], 'yield_unit_id');
        }

        if ($changes === []) {
            return $version;
        }

        $changes['updated_by'] = $this->context->userId();

        DB::transaction(function () use ($version, $changes, $expectedLockVersion): void {
            $this->compareAndSwap($version, $changes, $expectedLockVersion);
        });

        $this->audit->record(
            'catalogue.recipe_version_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $version->lock_version,
            ],
        );

        return $version;
    }

    /**
     * Replace every line of a version, atomically.
     *
     * Line numbers are server-authored from the submitted order: the array
     * *is* the sequence, so a client never has to keep numbering in step with
     * insertions. There is deliberately no uniqueness rule over ingredients —
     * a sheet that adds olive oil to the marinade and again to the finish is
     * two lines, and merging them would rewrite the method.
     *
     * **Costs (K1.3).** A line may carry `unit_cost_amount` and
     * `cost_currency_code`; `line_cost_amount` is never accepted, because a
     * derived value a client can supply is a derived value that can disagree
     * with its inputs (appendix C). It is computed here as quantity × unit
     * cost — the one place on the API where a line total is authored. The
     * importer writes line totals verbatim instead, on purpose: a source sheet
     * that adds up wrong is evidence, and evidence must not be silently
     * corrected.
     *
     * Both cost gates live in `CostVisibility`: writing a cost needs
     * `recipe.view_costs_organisation`, and so does *replacing a costed set
     * without costs*, which would erase money the caller could not see.
     *
     * @param  list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null, source_designation?: string|null, comment?: string|null}>  $lines
     *
     * @throws ApiException
     */
    public function setLines(RecipeVersion $version, array $lines, int $expectedLockVersion): RecipeVersion
    {
        $this->assertEditable($version);

        $prepared = [];
        $currencies = [];

        foreach ($lines as $index => $line) {
            $ingredient = $this->usableIngredient((string) $line['ingredient_id'], "lines.{$index}.ingredient_id");
            $quantity = $this->positiveDecimalOrNull($line['quantity'] ?? null, "lines.{$index}.quantity");
            $unitId = $this->trimmedOrNull(isset($line['unit_id']) ? (string) $line['unit_id'] : null);

            if ($unitId !== null) {
                $this->assertUnitExists($unitId, "lines.{$index}.unit_id");
            }

            [$unitCost, $currency] = $this->costOf($line, $index);

            if ($currency !== null) {
                $currencies[$currency] = true;
            }

            $prepared[] = [
                'line_number' => $index + 1,
                'ingredient_id' => (string) $ingredient->getKey(),
                'quantity' => $quantity,
                'unit_id' => $unitId,
                'unit_cost_amount' => $unitCost,

                // Derived here, never accepted: quantity × unit cost. Computed
                // by the costing service rather than inline, so that a line
                // total written today and a recalculation run tomorrow are
                // the same arithmetic rather than two implementations of it.
                'line_cost_amount' => $unitCost === null || $quantity === null
                    ? null
                    : $this->costing->lineCost($quantity, $unitCost),
                'cost_currency_code' => $currency,
                'source_designation' => $this->trimmedOrNull(isset($line['source_designation']) ? (string) $line['source_designation'] : null),
                'comment' => $this->trimmedOrNull(isset($line['comment']) ? (string) $line['comment'] : null),
            ];
        }

        if (count($currencies) > 1) {
            throw $this->invalid(
                'lines',
                'Every costed line of a version must be in the same currency, and this system never converts between them.',
                ['currencies' => array_keys($currencies)],
            );
        }

        $this->assertMayRewriteCosts($version, $currencies !== []);

        $this->replaceWithin($version, $expectedLockVersion, function () use ($version, $prepared): void {
            RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new RecipeVersionLine;
                $row->recipe_version_id = (string) $version->getKey();
                $row->organisation_id = $version->organisation_id;
                $row->line_number = $attributes['line_number'];
                $row->ingredient_id = $attributes['ingredient_id'];
                $row->quantity = $attributes['quantity'];
                $row->unit_id = $attributes['unit_id'];
                $row->unit_cost_amount = $attributes['unit_cost_amount'];
                $row->line_cost_amount = $attributes['line_cost_amount'];
                $row->cost_currency_code = $attributes['cost_currency_code'];
                $row->source_designation = $attributes['source_designation'];
                $row->comment = $attributes['comment'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.recipe_lines_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'changed_fields' => ['lines'],
                'line_count' => count($prepared),

                // A count, never the amounts: the audit trail must not become
                // a second copy of the cost surface that the cost permission
                // does not guard.
                'costed_line_count' => count(array_filter(
                    $prepared,
                    static fn (array $attributes): bool => $attributes['unit_cost_amount'] !== null,
                )),
                'lock_version' => $version->lock_version,
            ],
        );

        return $version;
    }

    /**
     * Replace what a version produces (master plan v2 §4.2).
     *
     * Exactly one primary output when the set is non-empty: "the thing this
     * recipe makes" has to be answerable without a tie-break. A set with no
     * outputs at all is legitimate — a component whose yield nobody has
     * measured yet — and is not the same as a set with two primaries, which is
     * a mistake.
     *
     * @param  list<array{ingredient_id: string, output_quantity: float|string, unit_id: string, is_primary?: bool}>  $outputs
     *
     * @throws ApiException
     */
    public function setOutputs(RecipeVersion $version, array $outputs, int $expectedLockVersion): RecipeVersion
    {
        $this->assertEditable($version);

        $prepared = [];
        $seen = [];
        $primaries = 0;

        foreach ($outputs as $index => $output) {
            $ingredient = $this->usableIngredient((string) $output['ingredient_id'], "outputs.{$index}.ingredient_id");
            $ingredientId = (string) $ingredient->getKey();

            if (in_array($ingredientId, $seen, true)) {
                throw $this->invalid("outputs.{$index}.ingredient_id", 'An ingredient may be produced once per version.');
            }

            $seen[] = $ingredientId;

            $quantity = $this->positiveDecimalOrNull($output['output_quantity'], "outputs.{$index}.output_quantity");

            if ($quantity === null) {
                throw $this->invalid("outputs.{$index}.output_quantity", 'An output must state how much it produces.');
            }

            $unitId = $this->trimmedOrNull((string) $output['unit_id']);

            if ($unitId === null) {
                throw $this->invalid("outputs.{$index}.unit_id", 'An output must state the unit it is measured in.');
            }

            $this->assertUnitExists($unitId, "outputs.{$index}.unit_id");

            $isPrimary = (bool) ($output['is_primary'] ?? false);
            $primaries += $isPrimary ? 1 : 0;

            $prepared[] = [
                'ingredient_id' => $ingredientId,
                'output_quantity' => $quantity,
                'unit_id' => $unitId,
                'is_primary' => $isPrimary,
            ];
        }

        if ($prepared !== [] && $primaries !== 1) {
            throw $this->invalid(
                'outputs',
                $primaries === 0
                    ? 'One output must be marked primary.'
                    : 'Only one output may be marked primary.',
            );
        }

        $this->replaceWithin($version, $expectedLockVersion, function () use ($version, $prepared): void {
            RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new RecipeVersionOutput;
                $row->recipe_version_id = (string) $version->getKey();
                $row->organisation_id = $version->organisation_id;
                $row->ingredient_id = $attributes['ingredient_id'];
                $row->output_quantity = $attributes['output_quantity'];
                $row->unit_id = $attributes['unit_id'];
                $row->is_primary = $attributes['is_primary'];
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.recipe_outputs_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'changed_fields' => ['outputs'],
                'output_count' => count($prepared),
                'lock_version' => $version->lock_version,
            ],
        );

        return $version;
    }

    /**
     * @param  list<array{instruction_en: string, instruction_ar?: string|null, minutes?: int|null}>  $steps
     *
     * @throws ApiException
     */
    public function setSteps(RecipeVersion $version, array $steps, int $expectedLockVersion): RecipeVersion
    {
        $this->assertEditable($version);

        $prepared = [];

        foreach ($steps as $index => $step) {
            $instruction = trim($step['instruction_en']);

            if ($instruction === '') {
                throw $this->invalid("steps.{$index}.instruction_en", 'A step must say what to do.');
            }

            $minutes = $step['minutes'] ?? null;

            if ($minutes !== null && $minutes < 0) {
                throw $this->invalid("steps.{$index}.minutes", 'A step duration cannot be negative.');
            }

            $prepared[] = [
                'step_number' => $index + 1,
                'instruction_en' => $instruction,
                'instruction_ar' => $this->trimmedOrNull(isset($step['instruction_ar']) ? (string) $step['instruction_ar'] : null),
                'minutes' => $minutes,
            ];
        }

        $this->replaceWithin($version, $expectedLockVersion, function () use ($version, $prepared): void {
            RecipeVersionStep::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new RecipeVersionStep;
                $row->recipe_version_id = (string) $version->getKey();
                $row->organisation_id = $version->organisation_id;
                $row->step_number = $attributes['step_number'];
                $row->instruction_en = $attributes['instruction_en'];
                $row->instruction_ar = $attributes['instruction_ar'];
                $row->minutes = $attributes['minutes'];
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.recipe_steps_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'changed_fields' => ['steps'],
                'step_count' => count($prepared),
                'lock_version' => $version->lock_version,
            ],
        );

        return $version;
    }

    /**
     * Publish a version: evaluate readiness, freeze the allergen label, demote
     * the incumbent, all in one transaction.
     *
     * The gates, in the order they are reported:
     *
     * - **State.** Only a draft publishes. A quarantined version
     *   (`review_required`) is blocked *structurally* — that is what the state
     *   is for (master plan v2 §4.7) — and a published or retired one is not a
     *   candidate at all.
     * - **Substance.** A version with no lines is a name, and a line without a
     *   quantity and a unit cannot be made twice the same way.
     * - **Ingredient trust.** An ingredient marked `requires_review` — the
     *   burghul/pita contradiction the source workbook contains, risk R1 —
     *   blocks publication until a human resolves it.
     * - **Allergen determination.** Every line ingredient must carry at least
     *   one mapping row in some layer, *or* be `verified`, which is how
     *   "checked, and it carries nothing" is recorded. Silence is not a
     *   statement of absence.
     *
     * The first three are collected together and raised as one
     * `catalogue.publish_blocked` with every reason, so a kitchen fixes
     * everything in one pass rather than discovering problems one attempt at a
     * time. The fourth has its own code because the fix is in a different
     * place — the ingredient's mapping editor, not the recipe.
     *
     * **Costing is not a gate** (K1.3). When every line is costed, publication
     * also writes a `recalculated` cost snapshot inside the same transaction
     * and flips `completeness` to `costed`. When it is not, publication
     * proceeds with no snapshot and `completeness` stays `indicative`. That
     * asymmetry is deliberate: cost is commercial and allergens are
     * food-safety, and holding a correct label hostage to a missing unit price
     * would teach a kitchen to publish first and fix labels later. The costing
     * path therefore cannot throw — see
     * `RecipeCostingService::costingForPublication()`.
     *
     * @throws ApiException
     */
    public function publish(RecipeVersion $version, int $expectedLockVersion): RecipeVersion
    {
        /** @var Collection<int, RecipeVersionLine> $lines */
        $lines = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('line_number')
            ->get();

        $this->assertPublishable($version, $lines);

        /** @var list<string> $orderedIngredientIds */
        $orderedIngredientIds = $lines->pluck('ingredient_id')->map(static fn (mixed $id): string => (string) $id)->all();

        $effective = $this->rollup->effectiveFor(array_values(array_unique($orderedIngredientIds)), $version->organisation_id);

        $this->assertAllergensDetermined($orderedIngredientIds, $effective);

        $rolled = $this->rollup->rollUp($orderedIngredientIds, $effective);
        $hash = $this->derivationHash($lines, $effective);
        $costing = $this->costing->costingForPublication($version, $lines);
        $now = now();

        $demoted = DB::transaction(function () use ($version, $expectedLockVersion, $rolled, $hash, $costing, $now): array {
            // The incumbent goes first: the partial unique index allows one
            // published version per recipe, so demoting before promoting keeps
            // the common path off the constraint entirely.
            $incumbents = RecipeVersion::withoutTenancy()
                ->where('recipe_id', $version->recipe_id)
                ->where('status', RecipeVersionStatus::Published->value)
                ->whereKeyNot($version->getKey())
                ->get();

            foreach ($incumbents as $incumbent) {
                RecipeVersion::withoutTenancy()
                    ->whereKey($incumbent->getKey())
                    ->update([
                        'status' => RecipeVersionStatus::Retired->value,
                        'lock_version' => $incumbent->lock_version + 1,
                        'updated_by' => $this->context->userId(),
                        'updated_at' => $now,
                    ]);
            }

            $this->compareAndSwap($version, [
                'status' => RecipeVersionStatus::Published->value,
                'published_at' => $now,
                'published_by' => $this->context->userId(),
                'derivation_state' => DerivationState::Current->value,
                'derived_at' => $now,
                'derived_input_hash' => $hash,
                'review_reason' => null,
                'updated_by' => $this->context->userId(),
            ] + ($costing === null ? [] : ['completeness' => RecipeCompleteness::Costed->value]), $expectedLockVersion);

            $this->freezeLabel($version, $rolled, $now);

            if ($costing !== null) {
                $this->costing->writeSnapshot($version, CostBasis::Recalculated, $costing, calculatedAt: $now);
            }

            return array_values($incumbents->map(static fn (RecipeVersion $row): string => (string) $row->getKey())->all());
        });

        foreach ($demoted as $retiredId) {
            $this->audit->record(
                'catalogue.recipe_version_retired',
                actorUserId: $this->context->userId(),
                subjectType: 'recipe_version',
                subjectId: $retiredId,
                metadata: ['recipe_id' => $version->recipe_id, 'origin' => 'superseded_by_publication'],
            );
        }

        $this->audit->record(
            'catalogue.recipe_version_published',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'recipe_id' => $version->recipe_id,
                'version_number' => $version->version_number,
                'line_count' => $lines->count(),
                'derived_allergen_classes' => array_map(static fn (array $row): string => $row['allergen_code'], $rolled),
                'superseded_version_ids' => $demoted,

                // Whether the version was fully costed at publication, never
                // what it cost. The audit trail is not behind the cost
                // permission, so it must not carry amounts.
                'completeness' => $version->completeness->value,
                'cost_snapshot_written' => $costing !== null,
                'lock_version' => $version->lock_version,
            ],
        );

        return $version;
    }

    /**
     * Withdraw a published version. Retirement is terminal: a retired version
     * is history, and history is what makes an old label reconstructable.
     *
     * @throws ApiException
     */
    public function retire(RecipeVersion $version, int $expectedLockVersion): RecipeVersion
    {
        if ($version->status !== RecipeVersionStatus::Published) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'Only a published version can be retired.',
                ['status' => $version->status->value, 'current_lock_version' => $version->lock_version],
            );
        }

        DB::transaction(function () use ($version, $expectedLockVersion): void {
            $this->compareAndSwap($version, [
                'status' => RecipeVersionStatus::Retired->value,
                'updated_by' => $this->context->userId(),
            ], $expectedLockVersion);
        });

        $this->audit->record(
            'catalogue.recipe_version_retired',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'recipe_id' => $version->recipe_id,
                'version_number' => $version->version_number,
                'origin' => 'explicit',
                'lock_version' => $version->lock_version,
            ],
        );

        return $version;
    }

    /**
     * @throws VersionImmutable
     */
    public function assertEditable(RecipeVersion $version): void
    {
        if (! $version->isEditable()) {
            throw new VersionImmutable($version->status);
        }
    }

    /**
     * @param  Collection<int, RecipeVersionLine>  $lines
     *
     * @throws PublishBlocked
     */
    private function assertPublishable(RecipeVersion $version, Collection $lines): void
    {
        $reasons = [];

        if ($version->status === RecipeVersionStatus::ReviewRequired) {
            $reasons[] = ['reason' => 'version_quarantined', 'review_reason' => $version->review_reason];
        } elseif ($version->status !== RecipeVersionStatus::Draft) {
            $reasons[] = ['reason' => 'version_not_a_draft', 'status' => $version->status->value];
        }

        if ($lines->isEmpty()) {
            $reasons[] = ['reason' => 'no_lines'];
        }

        $unquantified = $lines
            ->filter(static fn (RecipeVersionLine $line): bool => $line->quantity === null || $line->unit_id === null)
            ->map(static fn (RecipeVersionLine $line): int => $line->line_number)
            ->values()
            ->all();

        if ($unquantified !== []) {
            $reasons[] = ['reason' => 'line_quantity_missing', 'line_numbers' => $unquantified];
        }

        /** @var list<string> $ingredientIds */
        $ingredientIds = $lines->pluck('ingredient_id')->map(static fn (mixed $id): string => (string) $id)->unique()->values()->all();

        if ($ingredientIds !== []) {
            $quarantined = Ingredient::withoutTenancy()
                ->whereIn('id', $ingredientIds)
                ->where('verification_status', IngredientVerificationStatus::RequiresReview->value)
                ->orderBy('id')
                ->pluck('id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            if ($quarantined !== []) {
                $reasons[] = ['reason' => 'ingredient_requires_review', 'ingredient_ids' => $quarantined];
            }
        }

        if ($reasons !== []) {
            throw new PublishBlocked($reasons);
        }
    }

    /**
     * An ingredient passes when it has at least one mapping row in any layer,
     * or when it is `verified` — which is how "somebody checked, and it
     * carries nothing" is recorded. An ingredient with neither has simply not
     * been assessed, and that is not the same as being clear.
     *
     * @param  list<string>  $ingredientIds
     * @param  array<string, array<string, array{containment: mixed, market_scopes: list<string>}>>  $effective
     *
     * @throws AllergenUnmapped
     */
    private function assertAllergensDetermined(array $ingredientIds, array $effective): void
    {
        $candidates = array_values(array_unique(array_filter(
            $ingredientIds,
            static fn (string $id): bool => ($effective[$id] ?? []) === [],
        )));

        if ($candidates === []) {
            return;
        }

        $verified = Ingredient::withoutTenancy()
            ->whereIn('id', $candidates)
            ->where('verification_status', IngredientVerificationStatus::Verified->value)
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $undetermined = array_values(array_diff($candidates, $verified));
        sort($undetermined);

        if ($undetermined !== []) {
            throw new AllergenUnmapped($undetermined);
        }
    }

    /**
     * Write the frozen label.
     *
     * Declared rows survive: a chef who knows the fryer is shared has said
     * something no mapping implies, and a recomputation must not erase it. A
     * derived row replaces a declaration only when it is *stronger*, so the
     * label always carries the strongest claim anybody has made about each
     * class. Weakening a human's statement by computation is the one thing
     * this method will not do.
     *
     * @param  list<array{allergen_code: string, containment: AllergenContainment, source_ingredient_id: string, market_scopes: list<string>}>  $rolled
     */
    private function freezeLabel(RecipeVersion $version, array $rolled, mixed $now): void
    {
        /** @var Collection<int, RecipeVersionAllergen> $existing */
        $existing = RecipeVersionAllergen::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->get();

        /** @var array<string, RecipeVersionAllergen> $declared */
        $declared = $existing
            ->filter(static fn (RecipeVersionAllergen $row): bool => $row->derivation === AllergenDerivation::Declared)
            ->keyBy('allergen_code')
            ->all();

        foreach ($existing as $row) {
            if ($row->derivation === AllergenDerivation::Derived) {
                $row->delete();
            }
        }

        foreach ($rolled as $entry) {
            $incumbent = $declared[$entry['allergen_code']] ?? null;

            if ($incumbent !== null) {
                if ($entry['containment']->strength() <= $incumbent->containment->strength()) {
                    continue;
                }

                $incumbent->delete();
            }

            $row = new RecipeVersionAllergen;
            $row->recipe_version_id = (string) $version->getKey();
            $row->organisation_id = $version->organisation_id;
            $row->allergen_code = $entry['allergen_code'];
            $row->containment = $entry['containment'];
            $row->derivation = AllergenDerivation::Derived;
            $row->source_ingredient_id = $entry['source_ingredient_id'];

            // The market scopes live in the note rather than in a column: the
            // label is one row per class (UNIQUE on recipe_version_id,
            // allergen_code), so a scope column would either duplicate rows or
            // pick one scope and lose the rest. Recording them keeps a
            // US-only determination visible to a human reviewing the label.
            $row->source_note = 'Market scope: '.implode(', ', $entry['market_scopes']);
            $row->created_at = $now;
            $row->save();
        }
    }

    /**
     * A fingerprint of everything the label was computed from, so an identical
     * republish produces an identical hash and a changed input cannot
     * masquerade as an unchanged one.
     *
     * Ordered line tuples plus each line's effective allergen set — and
     * nothing else. No identifiers of the version, no timestamps, no actor:
     * two versions with the same formulation and the same mappings *are* the
     * same derivation, and a hash that said otherwise would make "has anything
     * really changed" unanswerable.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @param  array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>>  $effective
     */
    private function derivationHash(Collection $lines, array $effective): string
    {
        $payload = [];

        foreach ($lines as $line) {
            $allergens = [];

            foreach ($effective[$line->ingredient_id] ?? [] as $code => $mapping) {
                $allergens[] = $code.':'.$mapping['containment']->value.':'.implode('|', $mapping['market_scopes']);
            }

            sort($allergens);

            $payload[] = [
                'line_number' => $line->line_number,
                'ingredient_id' => $line->ingredient_id,
                'quantity' => $line->quantity === null ? null : (string) $line->quantity,
                'unit_id' => $line->unit_id,
                'allergens' => $allergens,
            ];
        }

        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
    }

    /**
     * Copy the content of one version onto another. Derived allergen rows are
     * deliberately not copied — they are a conclusion about a published state,
     * and the new draft has none.
     */
    private function copyContent(RecipeVersion $from, RecipeVersion $to): void
    {
        $lines = RecipeVersionLine::withoutTenancy()->where('recipe_version_id', $from->getKey())->orderBy('line_number')->get();

        foreach ($lines as $line) {
            $copy = $line->replicate(['id', 'recipe_version_id', 'created_at', 'updated_at']);
            $copy->recipe_version_id = (string) $to->getKey();
            $copy->organisation_id = $to->organisation_id;
            $copy->created_by = $this->context->userId();
            $copy->save();
        }

        foreach (RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $from->getKey())->get() as $output) {
            $copy = $output->replicate(['id', 'recipe_version_id', 'created_at']);
            $copy->recipe_version_id = (string) $to->getKey();
            $copy->organisation_id = $to->organisation_id;
            $copy->save();
        }

        foreach (RecipeVersionStep::withoutTenancy()->where('recipe_version_id', $from->getKey())->orderBy('step_number')->get() as $step) {
            $copy = $step->replicate(['id', 'recipe_version_id', 'created_at']);
            $copy->recipe_version_id = (string) $to->getKey();
            $copy->organisation_id = $to->organisation_id;
            $copy->save();
        }

        $declared = RecipeVersionAllergen::withoutTenancy()
            ->where('recipe_version_id', $from->getKey())
            ->where('derivation', AllergenDerivation::Declared->value)
            ->get();

        foreach ($declared as $row) {
            $copy = $row->replicate(['id', 'recipe_version_id', 'created_at']);
            $copy->recipe_version_id = (string) $to->getKey();
            $copy->organisation_id = $to->organisation_id;
            $copy->save();
        }
    }

    /**
     * A set-replace and its optimistic-lock bump in one transaction: either
     * the caller held the current validator and the whole set changed, or
     * nothing did.
     *
     * @param  Closure(): void  $work
     *
     * @throws ApiException
     */
    private function replaceWithin(RecipeVersion $version, int $expectedLockVersion, Closure $work): void
    {
        DB::transaction(function () use ($version, $expectedLockVersion, $work): void {
            $this->compareAndSwap($version, [
                'derivation_state' => DerivationState::Stale->value,
                'updated_by' => $this->context->userId(),
            ], $expectedLockVersion);

            $work();
        });
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function compareAndSwap(RecipeVersion $version, array $changes, int $expectedLockVersion): void
    {
        $affected = RecipeVersion::withoutTenancy()
            ->whereKey($version->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = RecipeVersion::withoutTenancy()->whereKey($version->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $version->refresh();
    }

    /**
     * @throws ApiException
     */
    private function usableIngredient(string $id, string $field): Ingredient
    {
        $ingredient = Ingredient::query()->whereKey($id)->first();

        if (! $ingredient instanceof Ingredient) {
            throw $this->invalid($field, 'This ingredient does not exist, or is not one you can use.');
        }

        // An archived ingredient is history. A list that quietly offered one
        // would invite somebody to build a formulation out of it, which is the
        // reason the catalogue list hides them by default too.
        if ($ingredient->status === IngredientStatus::Archived) {
            throw $this->invalid($field, 'This ingredient is archived and cannot be added to a recipe.');
        }

        return $ingredient;
    }

    /**
     * @throws ApiException
     */
    private function assertUnitExists(string $id, string $field): void
    {
        if (! MeasurementUnit::query()->whereKey($id)->exists()) {
            throw $this->invalid($field, 'This measurement unit does not exist.');
        }
    }

    /**
     * The cost half of one submitted line, as `[unit_cost_amount, currency]`.
     *
     * An amount without a currency is not a monetary value (master plan v2
     * §4.4) and a currency without an amount is not one either — the second is
     * refused rather than quietly dropped, because a client that sent it
     * believed it was writing something.
     *
     * @param  array{unit_cost_amount?: float|string|null, cost_currency_code?: string|null}  $line
     * @return array{0: numeric-string|null, 1: string|null}
     *
     * @throws ApiException
     */
    private function costOf(array $line, int $index): array
    {
        $unitCost = $this->nonNegativeDecimalOrNull($line['unit_cost_amount'] ?? null, "lines.{$index}.unit_cost_amount");
        $currency = $this->trimmedOrNull(isset($line['cost_currency_code']) ? (string) $line['cost_currency_code'] : null);
        $currency = $currency === null ? null : mb_strtoupper($currency);

        if ($unitCost !== null && $currency === null) {
            throw $this->invalid("lines.{$index}.cost_currency_code", 'A cost must say which currency it is in.');
        }

        if ($currency !== null && $unitCost === null) {
            throw $this->invalid("lines.{$index}.unit_cost_amount", 'A currency without an amount is not a cost.');
        }

        if ($currency !== null && ! Currency::query()->whereKey($currency)->exists()) {
            throw $this->invalid("lines.{$index}.cost_currency_code", 'This currency is not one the platform knows.');
        }

        return [$unitCost, $currency];
    }

    /**
     * Cost visibility guards the *write* path as well as the read path.
     *
     * Writing a cost blind is how a decimal point moves three places. Erasing
     * one blind is worse — line identity is positional, so the values cannot
     * be safely re-attached afterwards, and the person who destroyed them
     * could not have seen what they were.
     *
     * @throws ApiException
     */
    private function assertMayRewriteCosts(RecipeVersion $version, bool $submissionCarriesCosts): void
    {
        if ($submissionCarriesCosts) {
            $this->costVisibility->assertGranted('Writing a cost onto a recipe line requires permission to see costs.');

            return;
        }

        $existing = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->whereNotNull('unit_cost_amount')
            ->exists();

        if ($existing) {
            $this->costVisibility->assertGranted('This version carries costs, and replacing its lines would erase them. That requires permission to see costs.');
        }
    }

    /**
     * @return numeric-string|null
     *
     * @throws ApiException
     */
    private function nonNegativeDecimalOrNull(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        // Zero is legal and meaningful — a donated or self-produced input
        // costs nothing and saying so is not the same as saying nothing.
        if (! is_numeric($value) || (float) $value < 0) {
            throw $this->invalid($field, 'A cost must be a number that is not negative.');
        }

        return (string) $value;
    }

    /**
     * @return numeric-string|null the `is_numeric` guard below is what makes
     *                             this narrower than `string`, and it is what
     *                             lets the costing arithmetic take the value
     *                             without re-checking it
     *
     * @throws ApiException
     */
    private function positiveDecimalOrNull(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_numeric($value) || (float) $value <= 0) {
            throw $this->invalid($field, 'A quantity must be a number greater than zero.');
        }

        return (string) $value;
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function invalid(string $field, string $message, array $extra = []): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]] + $extra,
        );
    }

    private function trimmedOrNull(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
