<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Closure;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Exceptions\AllergenUnmapped;
use Healthy360\Recipes\Exceptions\PublishBlocked;
use Healthy360\Recipes\Exceptions\RecipeVersionInUse;
use Healthy360\Recipes\Exceptions\VersionImmutable;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Tenancy\TenantContext;
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
 *    no stored "publishable" flag to fall out of step with the data. Since
 *    K1.8 the evaluation itself lives in `RecipeVersionReadiness` and the
 *    label writing in `RecipeLabelWriter`, both shared with the reactive
 *    recompute job — one implementation of each food-safety rule, not two.
 */
final readonly class RecipeVersionService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private AllergenRollupService $rollup,
        private RecipeCostingService $costing,
        private CostVisibility $costVisibility,
        private RecipeUsageRegistry $usage,
        private RecipeVersionReadiness $readiness,
        private RecipeLabelWriter $labels,
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

            // Zero on a blank draft, where process waste starts at the source
            // sheets' three per cent. The asymmetry is deliberate: three is what
            // the sheets state for process loss and is a defensible default,
            // whereas nothing states a conventional packaging loss, and a
            // version whose packaging nobody has thought about should not
            // quietly inflate its cost by a figure nobody chose.
            $version->packaging_waste_percent = $copyFrom === null ? '0.00' : $copyFrom->packaging_waste_percent;

            /*
             * The list prices carry forward, unlike the derivation state below.
             * Opening the next draft of a priced recipe is the normal way a
             * recipe is edited — a line changes, the cost moves — and a draft
             * that arrived unpriced would present a blank margin against a real
             * cost, which reads as "this is sold at a loss" rather than "nobody
             * has retyped the price yet". The currency comes with them because
             * an amount without one is not a monetary value.
             */
            $version->b2b_price_amount = $copyFrom?->b2b_price_amount;
            $version->b2c_price_amount = $copyFrom?->b2c_price_amount;
            $version->price_currency_code = $copyFrom?->price_currency_code;
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

        foreach (['completeness', 'yield_quantity', 'yield_unit_id', 'yield_piece_count', 'input_quantity_total', 'waste_coefficient_percent', 'packaging_waste_percent', 'b2b_price_amount', 'b2c_price_amount', 'price_currency_code', 'notes'] as $field) {
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

            // An emptied price box clears the price, the same way an emptied
            // note clears the note. Without this the trimmed `''` reaches a
            // decimal column and Postgres refuses the whole save, which reads
            // to an operator as "the form is broken" rather than "that field
            // cannot be blank" — and blank is exactly what they meant.
            if ($value === '' && in_array($field, ['b2b_price_amount', 'b2c_price_amount', 'price_currency_code'], true)) {
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

        $prepared = $this->prepareLines($lines);

        $this->assertMayRewriteCosts($version, $this->anyCosted($prepared));

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
     * One submitted formulation, resolved into row attributes — and nothing
     * written.
     *
     * Lifted out of {@see setLines()} so that costing a *draft* runs the same
     * resolution a save would: the same catalogue lookups, the same
     * unit-to-unit price conversion, the same `lineCost()`. The alternative was
     * a second implementation for the preview, and a preview that computes its
     * total differently from the save is worse than no preview — it teaches a
     * kitchen a figure that changes when they press the button.
     *
     * Refusals are the same too, and deliberately so: a draft naming an
     * archived ingredient is told, on the step where the line is, rather than
     * being costed as though the ingredient were fine and refused later.
     *
     * @param  list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null, source_designation?: string|null, comment?: string|null}>  $lines
     * @return list<array{line_number: int, ingredient_id: string, quantity: numeric-string|null, unit_id: string|null, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null, cost_currency_code: string|null, source_designation: string|null, comment: string|null}>
     *
     * @throws ApiException
     */
    public function prepareLines(array $lines): array
    {
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

            // Nothing quoted on the request? Take what the catalogue says.
            if ($unitCost === null && $currency === null) {
                [$unitCost, $currency] = $this->ingredientCostFor($ingredient, $unitId);
            }

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

        return $prepared;
    }

    /**
     * Whether any prepared row carries a price — the question
     * `assertMayRewriteCosts()` asks, kept out of the preparation so that
     * preparing and gating stay separable.
     *
     * @param  list<array{unit_cost_amount: numeric-string|null, ...}>  $prepared
     */
    private function anyCosted(array $prepared): bool
    {
        foreach ($prepared as $attributes) {
            if ($attributes['unit_cost_amount'] !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * Replace a version's packaging — what its output goes out in.
     *
     * The sibling of {@see setLines()}, and a PUT for the same reason: the body
     * is the complete list, so "I removed the sleeve" and "I forgot to send the
     * sleeve" stay different requests.
     *
     * ## Two of the three quantities are computed here, not accepted
     *
     * A hand-typed bottle count is wrong the moment the yield changes and
     * nothing says so — the source workbook is carrying exactly that defect,
     * with one bottle recorded against a 1.7 kg batch. So the basis says where
     * the number comes from and this method derives it:
     *
     * - `fills_yield`: `ceil(yield / capacity)`, refused when the version
     *   states no yield or the item states no capacity, because there is
     *   nothing to divide and a guess would be indistinguishable from a
     *   measurement.
     * - `per_container`: the total of every `fills_yield` quantity on this
     *   submission. Resolved in a second pass, after the first has counted the
     *   containers — which is why this cannot be one loop.
     * - `per_batch`: taken from the request, and the only one that is.
     *
     * A client that sends a quantity on a derived basis is not corrected
     * silently, it is told. A form that accepts a figure and then ignores it is
     * the same failure as the ingredient price this slice began by fixing.
     *
     * ## The unit cost is copied, not joined
     *
     * Read off the packaging item at write time and stored on the row, exactly
     * as `setLines()` does with an ingredient's. A sheet costed in March must
     * still say what it said in March after somebody edits the bottle's price
     * in April; a join would rewrite history every time a supplier moved.
     *
     * @param  list<array{ingredient_id: string, basis: string, quantity?: float|string|null, comment?: string|null}>  $packaging
     *
     * @throws ApiException
     */
    public function setPackaging(RecipeVersion $version, array $packaging, int $expectedLockVersion): RecipeVersion
    {
        $this->assertEditable($version);

        $prepared = $this->preparePackaging($version, $packaging);

        $this->replaceWithin($version, $expectedLockVersion, function () use ($version, $prepared): void {
            RecipeVersionPackaging::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();

            foreach ($prepared as $attributes) {
                $row = new RecipeVersionPackaging;
                $row->recipe_version_id = (string) $version->getKey();
                $row->organisation_id = $version->organisation_id;
                $row->line_number = $attributes['line_number'];
                $row->ingredient_id = $attributes['ingredient_id'];
                $row->basis = $attributes['basis'];
                $row->quantity = (string) $attributes['quantity'];
                $row->unit_id = $attributes['unit_id'];
                $row->unit_cost_amount = $attributes['unit_cost_amount'];
                $row->line_cost_amount = $attributes['line_cost_amount'];
                $row->cost_currency_code = $attributes['cost_currency_code'];
                $row->comment = $attributes['comment'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $this->audit->record(
            'catalogue.recipe_packaging_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'changed_fields' => ['packaging'],
                'line_count' => count($prepared),

                // A count, never the amounts. An audit row is readable with
                // `audit.view_organisation`, which is not the cost permission,
                // so one figure here would route around the whole split.
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
     * One submitted packaging set, resolved into row attributes — and nothing
     * written.
     *
     * The sibling of {@see prepareLines()}, lifted out of
     * {@see setPackaging()} for the same reason: a draft's packaging cost has
     * to be derived by the arithmetic that will derive it on save, including
     * the two passes that resolve `fills_yield` and then `per_container`.
     *
     * `$version` is read for its yield only, and may be an unsaved instance —
     * which is what lets a recipe nobody has created yet be costed against the
     * yield somebody has just typed.
     *
     * @param  list<array{ingredient_id: string, basis: string, quantity?: float|string|null, comment?: string|null}>  $packaging
     * @return list<array{line_number: int, ingredient_id: string, basis: PackagingBasis, quantity: numeric-string, unit_id: string|null, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null, cost_currency_code: string|null, comment: string|null}>
     *
     * @throws ApiException
     */
    public function preparePackaging(RecipeVersion $version, array $packaging): array
    {
        $prepared = [];
        $currencies = [];
        $containerCount = '0';

        foreach ($packaging as $index => $line) {
            $item = $this->usablePackagingItem((string) $line['ingredient_id'], "packaging.{$index}.ingredient_id");
            $basis = PackagingBasis::from((string) $line['basis']);

            $typed = $this->positiveDecimalOrNull($line['quantity'] ?? null, "packaging.{$index}.quantity");

            if (! $basis->isTyped() && $typed !== null) {
                throw $this->invalid(
                    "packaging.{$index}.quantity",
                    'This basis works its own quantity out. Send it without one, or change the basis to a fixed amount per batch.',
                );
            }

            $quantity = match ($basis) {
                PackagingBasis::FillsYield => $this->containersFor($version, $item, $index),

                // Left null here on purpose: the container total is not known
                // until every `fills_yield` line has been read.
                PackagingBasis::PerContainer => null,
                PackagingBasis::PerBatch => $typed ?? throw $this->invalid(
                    "packaging.{$index}.quantity",
                    'A fixed amount per batch needs a quantity.',
                ),
            };

            if ($basis === PackagingBasis::FillsYield) {
                $containerCount = bcadd($containerCount, (string) $quantity, 4);
            }

            [$unitCost, $currency] = $this->packagingCostOf($item);

            if ($currency !== null) {
                $currencies[$currency] = true;
            }

            $prepared[] = [
                'line_number' => $index + 1,
                'ingredient_id' => (string) $item->getKey(),
                'basis' => $basis,
                'quantity' => $quantity,
                'unit_id' => $item->default_unit_id,
                'unit_cost_amount' => $unitCost,
                'cost_currency_code' => $currency,
                'comment' => $this->trimmedOrNull(isset($line['comment']) ? (string) $line['comment'] : null),
            ];
        }

        /*
         * The second pass. A `per_container` line is one item per container, so
         * it needs the count every `fills_yield` line added up to — and that is
         * only known once the whole submission has been read.
         *
         * A version with no container line has no containers, so a
         * `per_container` line on one is a statement about nothing. Refused
         * rather than costed as zero, because costing it as zero would hide the
         * fact that the missing container line is the actual mistake.
         */
        foreach ($prepared as $index => $attributes) {
            if ($attributes['basis'] !== PackagingBasis::PerContainer) {
                continue;
            }

            if (bccomp($containerCount, '0', 4) !== 1) {
                throw $this->invalid(
                    "packaging.{$index}.basis",
                    'Nothing on this version fills the yield, so there are no containers for this line to go one per. Add the container it belongs to, or price it per batch.',
                );
            }

            $prepared[$index]['quantity'] = $containerCount;
        }

        // `line_cost_amount` is derived and never accepted, through the same
        // `lineCost()` the formulation uses — so a packaging total written today
        // and a recalculation run tomorrow are one arithmetic rather than two
        // implementations of it.
        foreach ($prepared as $index => $attributes) {
            $prepared[$index]['line_cost_amount'] = $attributes['unit_cost_amount'] === null
                ? null
                : $this->costing->lineCost($prepared[$index]['quantity'], $attributes['unit_cost_amount']);
        }

        if (count($currencies) > 1) {
            throw $this->invalid(
                'packaging',
                'Every costed packaging line of a version must be in the same currency, and this system never converts between them.',
                ['currencies' => array_keys($currencies)],
            );
        }

        return $prepared;
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
     * **The gates themselves live in `RecipeVersionReadiness`** (K1.8), so that
     * `GET …/readiness` can answer "is this publishable, and if not why" without
     * attempting a publication. This method reads the same list and throws from
     * it; there is no second copy of a food-safety gate to drift.
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
        $lines = $this->readiness->linesOf($version);

        $structural = $this->readiness->structuralReasons($version, $lines);

        if ($structural !== []) {
            throw PublishBlocked::fromReadiness($structural);
        }

        /** @var list<string> $orderedIngredientIds */
        $orderedIngredientIds = $lines->pluck('ingredient_id')->map(static fn (mixed $id): string => (string) $id)->all();

        $effective = $this->rollup->effectiveFor(array_values(array_unique($orderedIngredientIds)), $version->organisation_id);
        $undetermined = $this->readiness->undeterminedIngredientIds($orderedIngredientIds, $effective);

        if ($undetermined !== []) {
            throw new AllergenUnmapped($undetermined);
        }

        $rolled = $this->rollup->rollUp($orderedIngredientIds, $effective);
        $hash = $this->labels->derivationHash($lines, $effective);
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

            $this->labels->freeze($version, $rolled, $now);

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
     * **Refused while a published catalogue item sells the recipe** (K1.4).
     * That item's allergen label is derived from this version, so retiring it
     * would leave a listing describing a formulation the system no longer
     * holds. Asked through `RecipeUsageRegistry` rather than by querying
     * catalogue tables: the dependency edge runs Catalogues → Recipes, and
     * this module must not learn that catalogues exist.
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

        $recipe = Recipe::withoutTenancy()->whereKey($version->recipe_id)->first();

        if ($recipe instanceof Recipe) {
            $items = $this->usage->publishedItemIds($recipe);

            if ($items !== []) {
                throw new RecipeVersionInUse($items);
            }
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
     * Copy the content of one version onto another. Derived allergen rows are
     * deliberately not copied — they are a conclusion about a published state,
     * and the new draft has none.
     */
    private function copyContent(RecipeVersion $from, RecipeVersion $to): void
    {
        /*
         * Packaging is copied with everything else, and its *stored* quantities
         * come with it rather than being recomputed against the new draft.
         *
         * The new draft is a copy, so its yield is the old one's and the two
         * derivations agree by construction. Recomputing here would make the
         * copy differ from its source the moment a packaging item's capacity
         * had been edited since — which is precisely the history-rewriting this
         * table stores its costs to avoid. The next `setPackaging()` is what
         * re-derives them, on purpose and with somebody looking.
         */
        $packaging = RecipeVersionPackaging::withoutTenancy()->where('recipe_version_id', $from->getKey())->orderBy('line_number')->get();

        foreach ($packaging as $row) {
            $copy = $row->replicate(['id', 'recipe_version_id', 'created_at', 'updated_at']);
            $copy->recipe_version_id = (string) $to->getKey();
            $copy->organisation_id = $to->organisation_id;
            $copy->created_by = $this->context->userId();
            $copy->save();
        }

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
        /*
         * Food only.
         *
         * Packaging shares this table — a recipe has to be able to cost the box its meal
         * ships in — but a recipe line or output names a raw material. Without the scope a
         * bin liner is a legal answer here, and the roll-up would then be asked to derive
         * nutrition and allergens from it.
         */
        $ingredient = Ingredient::query()->excludingPackaging()->whereKey($id)->first();

        if (! $ingredient instanceof Ingredient) {
            throw $this->invalid($field, 'This ingredient does not exist, or is not one you can use.');
        }

        // An archived ingredient is history. A list that quietly offered one
        // would invite somebody to build a formulation out of it, which is the
        // reason the catalogue list hides them by default too.
        if ($ingredient->status === IngredientStatus::Archived) {
            throw $this->invalid($field, 'This ingredient is archived and cannot be added to a recipe.');
        }

        // Inactive is the operator's "do not use this" switch: the row stays
        // visible (greyed) in the kitchen tables, but nothing new may be
        // built on it until somebody flips it back.
        if ($ingredient->status === IngredientStatus::Inactive) {
            throw $this->invalid($field, 'This ingredient is inactive and cannot be added to a recipe until it is reactivated.');
        }

        return $ingredient;
    }

    /**
     * The catalogue's own price for one line's ingredient, as `[amount, currency]`.
     *
     * ## Why this exists
     *
     * The recipe editor writes lines with no cost on them — it sends the ingredient, the quantity
     * and the unit, which is everything a *formulation* is — and nothing else in the product ever
     * filled the gap. So every line this system has written has been uncosted, and the technical
     * sheet has been correctly reporting that it cannot total a version whose every line is
     * missing a price. A kitchen could price its whole ingredient catalogue and still see no
     * recipe cost anywhere, with nothing on screen to say why.
     *
     * The packaging path has never had this problem because `setPackaging()` reads the item's
     * price off the catalogue at write time. This is that same rule for the formulation, and the
     * two now behave alike.
     *
     * ## Only when the caller quoted nothing
     *
     * A request that states a cost still wins. The importer records what a source sheet said,
     * errors included (`as_recorded`), and a fallback that overrode it would replace a
     * transcription with a guess at what it should have been.
     *
     * ## Converted within a dimension, and never across one
     *
     * An ingredient's price is per its purchase pack where it records one, and per its issue unit
     * otherwise. A line may be written in any unit of the same dimension — grams against an
     * ingredient bought by the kilo, which is how most recipes are actually written.
     *
     * This first refused to convert at all, on the reasoning that a silent conversion could produce
     * a figure a thousandfold wrong. The caution was right and the conclusion was not: `kg` and `g`
     * are the *same dimension* and `measurement_units.base_ratio` states the exact relationship
     * between them, so the conversion is arithmetic rather than a guess. Refusing it meant the most
     * natural way to write a formulation never costed, which sent people to the workaround of
     * restating every quantity in the purchase unit.
     *
     * What is still refused is a conversion **across** dimensions — a price per `piece` against a
     * line in `kg`. Nothing in the reference data relates those two, and the factor that would is a
     * property of the specific ingredient (a piece of what, weighing how much?) that this system
     * does not record. Such a line stays uncosted: the sheet lists it in `uncosted_line_numbers`,
     * withholds the total, and says which line to go and look at.
     *
     * @return array{0: numeric-string|null, 1: string|null}
     */
    private function ingredientCostFor(Ingredient $ingredient, ?string $lineUnitId): array
    {
        $price = $ingredient->purchase_price_amount;
        $currency = $ingredient->purchase_price_currency;

        if ($price === null || $currency === null || $lineUnitId === null) {
            return [null, null];
        }

        $pricedIn = $ingredient->purchase_unit_id ?? $ingredient->default_unit_id;

        if ($pricedIn === $lineUnitId) {
            return [(string) $price, mb_strtoupper($currency)];
        }

        $converted = $this->pricePerUnit((string) $price, $pricedIn, $lineUnitId);

        return $converted === null ? [null, null] : [$converted, mb_strtoupper($currency)];
    }

    /**
     * A price stated per one unit, restated per another of the same dimension.
     *
     * `base_ratio` is how many base units one of this unit is — 1000 for `kg` against a base of
     * `g`. So a price per kilogram becomes a price per gram by dividing by the ratio between them,
     * and 7.88 per kg is 0.00788 per g exactly.
     *
     * Null when the two units are not comparable: a different dimension, an unknown unit, or a
     * ratio of zero. Every one of those is "this system cannot know", and the caller turns it into
     * an uncosted line rather than a figure.
     *
     * Six decimal places, the scale every cost column stores. A price per gram of a cheap bulk
     * ingredient can round to zero at that scale, and that is the honest floor of what these
     * columns can hold rather than something to work around here.
     *
     * @param  numeric-string  $price
     * @return numeric-string|null
     */
    private function pricePerUnit(string $price, string $fromUnitId, string $toUnitId): ?string
    {
        /** @var MeasurementUnit|null $from */
        $from = MeasurementUnit::query()->whereKey($fromUnitId)->first();
        /** @var MeasurementUnit|null $to */
        $to = MeasurementUnit::query()->whereKey($toUnitId)->first();

        if (! $from instanceof MeasurementUnit || ! $to instanceof MeasurementUnit) {
            return null;
        }

        if ($from->dimension !== $to->dimension) {
            return null;
        }

        $fromRatio = (string) $from->base_ratio;
        $toRatio = (string) $to->base_ratio;

        if (bccomp($fromRatio, '0', 9) !== 1) {
            return null;
        }

        // price_per_to = price_per_from × (to_ratio ÷ from_ratio).
        return bcmul($price, bcdiv($toRatio, $fromRatio, 12), 6);
    }

    /**
     * A packaging item this organisation may build a version on.
     *
     * The exact shape of `usableIngredient()`, one family over, and refusing
     * the same two states for the same reasons: an archived row is history and
     * offering it invites somebody to cost a version against a box nobody
     * stocks, and `inactive` is the operator's "do not use this" switch, which
     * a recipe editor must honour rather than route around.
     *
     * Platform-library rows are usable, unlike tenant rows of another
     * organisation — the model's own scope handles that distinction, so a
     * lookup that finds nothing is either "does not exist" or "not yours", and
     * the message deliberately does not say which.
     *
     * @throws ApiException
     */
    private function usablePackagingItem(string $id, string $field): Ingredient
    {
        /*
         * Packaging only — the mirror of the food scope on `usableIngredient` above.
         *
         * The two families share a table again, so "this id exists" is no longer the same question
         * as "this id is a box". Without the scope a chef could put chickpeas on the Packaging tab
         * and the cost cascade would price them per container.
         */
        $item = Ingredient::query()->onlyPackaging()->whereKey($id)->first();

        if (! $item instanceof Ingredient) {
            throw $this->invalid($field, 'This packaging item does not exist, or is not one you can use.');
        }

        if ($item->status === IngredientStatus::Archived) {
            throw $this->invalid($field, 'This packaging item is archived and cannot be added to a recipe.');
        }

        if ($item->status === IngredientStatus::Inactive) {
            throw $this->invalid($field, 'This packaging item is inactive and cannot be added to a recipe until it is reactivated.');
        }

        return $item;
    }

    /**
     * How many of this container the version's yield fills.
     *
     * `ceil(yield / capacity)` — six 0.3 kg bottles for a 1.7 kg batch. Both
     * inputs are required and neither is guessed at: without a yield there is
     * nothing to divide, and without a capacity there is nothing to divide by.
     * Either absence is a refusal rather than a fallback to `1`, because a
     * fallback would put a plausible number on a technical sheet that nobody
     * measured and nobody could later tell apart from one that was.
     *
     * The unit is not checked against the yield's, and that is the design
     * rather than an omission: a capacity is *defined* as being stated in the
     * unit the recipe's yield is stated in (see the migration on
     * `packaging_items`), which is what keeps this division same-unit and free
     * of any need for a density.
     *
     * `ceil`, because two thirds of a bottle holds nothing. The half-empty last
     * container is real and is what the packaging waste coefficient accounts
     * for; rounding the count down would understate the cost instead.
     *
     * @return numeric-string
     *
     * @throws ApiException
     */
    private function containersFor(RecipeVersion $version, Ingredient $item, int $index): string
    {
        $yield = $version->yield_quantity;

        if ($yield === null || bccomp((string) $yield, '0', 4) !== 1) {
            throw $this->invalid(
                "packaging.{$index}.basis",
                'This version states no yield, so there is nothing for a container to be filled from. Set the yield, or price this line per batch.',
            );
        }

        $capacity = $item->capacity_quantity;

        if ($capacity === null || bccomp((string) $capacity, '0', 4) !== 1) {
            throw $this->invalid(
                "packaging.{$index}.ingredient_id",
                'This packaging item does not say how much it holds, so the number needed cannot be worked out. Record its capacity, or price this line per batch.',
            );
        }

        // bcdiv truncates, so the ceiling is the quotient plus one whenever the
        // division left a remainder. Done in decimal rather than by casting to
        // float and calling ceil(): a yield of 1.7 into a capacity of 0.1 is
        // exactly 17 in decimal and 16.999999999999996 in IEEE 754, and the
        // float route would quietly bill an eighteenth container.
        $whole = bcdiv((string) $yield, (string) $capacity, 0);

        return bccomp(bcmul($whole, (string) $capacity, 4), (string) $yield, 4) === 0
            ? $whole
            : bcadd($whole, '1', 0);
    }

    /**
     * The unit cost of one packaging item, as `[amount, currency]`.
     *
     * Read from the item rather than accepted from the request — the client has
     * no business quoting a price the catalogue already holds, and letting it
     * would make the two disagree. Copied onto the row at write time so that a
     * sheet costed in March still says what it said in March.
     *
     * A pack price divided by the pieces in the pack, when the item states
     * both: a case of 500 lids at 40.00 is 0.08 a lid, and a recipe consumes
     * lids rather than cases. Without `items_per_unit` the price is taken as
     * being per issued piece already, which is what a row that quotes a price
     * and no pack size is saying.
     *
     * Null where nothing is recorded, and null propagates: an unpriced box
     * contributes no line cost and lands in the sheet's uncosted list, rather
     * than being totalled as free.
     *
     * @return array{0: numeric-string|null, 1: string|null}
     */
    private function packagingCostOf(Ingredient $item): array
    {
        $price = $item->purchase_price_amount;
        $currency = $item->purchase_price_currency;

        if ($price === null || $currency === null) {
            return [null, null];
        }

        $perUnit = (string) $price;
        $perPack = $item->items_per_unit;

        if ($perPack !== null && bccomp((string) $perPack, '0', 4) === 1) {
            $perUnit = bcdiv($perUnit, (string) $perPack, 6);
        }

        return [$perUnit, mb_strtoupper($currency)];
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
