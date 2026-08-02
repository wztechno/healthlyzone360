<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Exceptions\MixedCostCurrency;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use RuntimeException;

/**
 * What a recipe version costs, and the append-only record of what it cost.
 *
 * Four rules run through all of it.
 *
 * 1. **Strings and bcmath, never floats.** Every amount is a major-unit
 *    decimal with six places (master plan v2 §4.4). Binary floating point
 *    cannot represent `0.1`, so a float total depends on the order the lines
 *    were summed in — and a cost that changes when somebody reorders a
 *    formulation is not a cost. Intermediate arithmetic runs at twelve places
 *    and is rounded half-up to six exactly once, at the end of each figure.
 * 2. **One currency, no conversion.** There is no exchange rate anywhere in
 *    this system and §4.4 forbids adding one here. Lines in two currencies are
 *    refused rather than reconciled.
 * 3. **The basis comes from the yield fields, never from a label.** Appendix D
 *    findings #1 and #2: at least five source sheets label a figure "cost per
 *    kg" beside a piece count, or the reverse. So a per-yield-unit cost exists
 *    when — and only when — the *version* states a yield quantity and unit, a
 *    per-piece cost exists when the version states a piece count, and the
 *    sheet's own wording is kept in `source_label` as evidence rather than as
 *    input. `basis_mismatch` records that the two disagree.
 * 4. **An incomplete costing is a report, not a snapshot.** A total that
 *    silently omits an uncosted line reads exactly like a total that did not.
 *    `CostComputation::isComplete()` is the gate and `writeSnapshot()` is the
 *    only thing that consults it.
 */
final readonly class RecipeCostingService
{
    /**
     * The working precision. Six places is what the columns store; twelve is
     * what the intermediate steps use so that a division followed by a
     * multiplication does not lose a place at each hop.
     */
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /**
     * Words that make a source label a claim about *pieces*. Deliberately
     * short and deliberately English-only: the labels come from one workbook,
     * and a clever multilingual matcher would produce confident nonsense on
     * wording nobody has seen.
     *
     * @var list<string>
     */
    private const array PIECE_LABEL_WORDS = ['piece', 'pieces', 'pc', 'pcs', 'portion', 'portions', 'unit', 'units', 'each', 'serving', 'servings'];

    /**
     * Words that make a source label a claim about a *measured* yield.
     *
     * @var list<string>
     */
    private const array MEASURED_LABEL_WORDS = ['kg', 'kilo', 'kilogram', 'kilogramme', 'g', 'gram', 'gramme', 'l', 'lt', 'litre', 'liter', 'ml', 'lb', 'oz'];

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * Cost a version from its own lines.
     *
     * A line contributes when it carries **both** a quantity and a unit cost;
     * anything else is listed in `uncostedLineNumbers` and blocks a snapshot.
     * The master plan's wording is "every line with a quantity has a unit
     * cost"; this implementation is strictly wider, because a line with a
     * price and no amount cannot be multiplied either, and a total that
     * quietly skipped it would understate the formulation by exactly the
     * ingredient somebody forgot to measure.
     *
     * @param  Collection<int, RecipeVersionLine>|null  $lines  pre-loaded lines, to save the publish path a second query
     *
     * @throws MixedCostCurrency
     */
    public function computeRecalculated(RecipeVersion $version, ?Collection $lines = null): CostComputation
    {
        $lines ??= $this->linesOf($version);

        $currency = $this->soleCurrency($lines);

        $lineCosts = [];
        $uncosted = [];
        $total = '0';

        foreach ($lines as $line) {
            $quantity = $line->quantity;
            $unitCost = $line->unit_cost_amount;

            if ($quantity === null || $unitCost === null || $line->cost_currency_code === null) {
                $uncosted[] = $line->line_number;

                continue;
            }

            $cost = $this->lineCost($this->numeric($quantity), $this->numeric($unitCost));

            $lineCosts[$line->line_number] = $cost;
            $total = bcadd($total, $cost, self::WORKING_SCALE);
        }

        sort($uncosted);

        // The total is the sum of the *rounded* line costs, not the rounded sum
        // of exact ones: a technical sheet is read by a human adding up the
        // line column, and a total that disagreed with that sum by a millionth
        // would be queried every time.
        $total = $this->round($total);
        $waste = $this->numeric($version->waste_coefficient_percent);

        // The two denominators, each existing only when the version says it
        // does. `yield_unit_id` without `yield_quantity` buys nothing — a unit
        // with no amount is not a yield — so both are required.
        $yield = $version->yield_quantity === null ? null : $this->numeric($version->yield_quantity);

        $perYieldUnit = $yield !== null && $version->yield_unit_id !== null && bccomp($yield, '0', self::WORKING_SCALE) === 1
            ? $this->round(bcdiv($total, $yield, self::WORKING_SCALE))
            : null;

        $perPiece = $version->yield_piece_count !== null && $version->yield_piece_count > 0
            ? $this->round(bcdiv($total, $this->numeric((string) $version->yield_piece_count), self::WORKING_SCALE))
            : null;

        return new CostComputation(
            currencyCode: $lineCosts === [] ? null : $currency,
            totalInputCostAmount: $total,
            lineCosts: $lineCosts,
            uncostedLineNumbers: $uncosted,
            costPerYieldUnitAmount: $perYieldUnit,
            yieldUnitId: $perYieldUnit === null ? null : $version->yield_unit_id,
            costPerPieceAmount: $perPiece,
            wasteCoefficientPercent: $waste,
            costPerYieldUnitWithWasteAmount: $perYieldUnit === null ? null : $this->withWaste($perYieldUnit, $waste),
            costPerPieceWithWasteAmount: $perPiece === null ? null : $this->withWaste($perPiece, $waste),
        );
    }

    /**
     * The publication path's view of costing: a complete computation, or null.
     *
     * **This method never throws, and that is the whole design.** Costing is
     * commercial, not food-safety: a formulation whose allergen label is
     * correct and whose costs are half-entered is safe to serve and must not
     * be blocked from publication over a missing price. Publishing without
     * costs leaves the version `indicative`; publishing with them writes a
     * `recalculated` snapshot and flips it to `costed`. Mixed currencies are
     * swallowed here for the same reason — the data problem is real, but
     * refusing to publish over it would hold a correct allergen label hostage
     * to a bookkeeping error.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     */
    public function costingForPublication(RecipeVersion $version, Collection $lines): ?CostComputation
    {
        try {
            $computation = $this->computeRecalculated($version, $lines);
        } catch (MixedCostCurrency) {
            return null;
        }

        return $computation->isComplete() ? $computation : null;
    }

    /**
     * Append a snapshot.
     *
     * `$basisMismatch` is `null` by default, which means "work it out from the
     * label" — the appendix D rule, applied in one place. Passing an explicit
     * boolean is for the importer, which sometimes knows from the surrounding
     * sheet what the wording alone cannot say.
     *
     * @throws RuntimeException when handed a computation that must not be persisted
     */
    public function writeSnapshot(
        RecipeVersion $version,
        CostBasis $basis,
        CostComputation $computation,
        ?string $sourceLabel = null,
        ?bool $basisMismatch = null,
        ?DateTimeInterface $calculatedAt = null,
    ): RecipeCostSnapshot {
        if (! $computation->isComplete()) {
            // Not an ApiException: every caller checks isComplete() and turns
            // the report into its own refusal. Reaching here is a programming
            // error, and dressing one up as a 422 would hide it.
            throw new RuntimeException('A cost snapshot cannot be written from an incomplete computation.');
        }

        $snapshot = new RecipeCostSnapshot;
        $snapshot->recipe_version_id = (string) $version->getKey();
        $snapshot->organisation_id = $version->organisation_id;
        $snapshot->currency_code = (string) $computation->currencyCode;
        $snapshot->basis = $basis;
        $snapshot->total_input_cost_amount = $computation->totalInputCostAmount;
        $snapshot->cost_per_yield_unit_amount = $computation->costPerYieldUnitAmount;
        $snapshot->yield_unit_id = $computation->yieldUnitId;
        $snapshot->cost_per_piece_amount = $computation->costPerPieceAmount;
        $snapshot->waste_coefficient_percent = $computation->wasteCoefficientPercent;
        $snapshot->cost_per_yield_unit_with_waste_amount = $computation->costPerYieldUnitWithWasteAmount;
        $snapshot->cost_per_piece_with_waste_amount = $computation->costPerPieceWithWasteAmount;
        $snapshot->source_label = $sourceLabel;
        $snapshot->basis_mismatch = $basisMismatch ?? $this->labelContradictsYield($computation, $sourceLabel);
        $snapshot->calculated_at = CarbonImmutable::instance($calculatedAt ?? now());
        $snapshot->created_by = $this->context->userId();
        $snapshot->save();

        // No amounts in the metadata. An audit trail that carried the numbers
        // would become a second, unprotected copy of the cost surface — the
        // one place `recipe.view_costs_organisation` does not reach.
        $this->audit->record(
            'catalogue.recipe_cost_snapshot_created',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'snapshot_id' => (string) $snapshot->getKey(),
                'basis' => $basis->value,
                'currency' => $snapshot->currency_code,
                'costed_line_count' => count($computation->lineCosts),
                'basis_mismatch' => $snapshot->basis_mismatch,
                'source_label' => $sourceLabel,
            ],
        );

        return $snapshot;
    }

    /**
     * The line numbers that carry no computable cost, without any of the
     * currency arithmetic.
     *
     * The technical sheet reads this rather than `computeRecalculated()`: the
     * sheet is a *read*, and a read that answered `422` because an old import
     * left two currencies behind would hide the very page a human needs in
     * order to see the problem.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @return list<int>
     */
    public function uncostedLineNumbers(Collection $lines): array
    {
        $uncosted = $lines
            ->filter(static fn (RecipeVersionLine $line): bool => $line->quantity === null
                || $line->unit_cost_amount === null
                || $line->cost_currency_code === null)
            ->map(static fn (RecipeVersionLine $line): int => $line->line_number)
            ->values()
            ->all();

        sort($uncosted);

        return $uncosted;
    }

    /**
     * quantity × unit cost, rounded once to the six places the column stores.
     *
     * Public because the lines endpoint derives `line_cost_amount` on write
     * and must use exactly the arithmetic a later recalculation will use. Two
     * implementations of one multiplication is two answers, and the one a
     * kitchen sees would depend on which code path last touched the row.
     *
     * @param  numeric-string  $quantity
     * @param  numeric-string  $unitCost
     * @return numeric-string
     */
    public function lineCost(string $quantity, string $unitCost): string
    {
        return $this->round(bcmul($quantity, $unitCost, self::WORKING_SCALE));
    }

    /**
     * The currencies present on the costed lines, in the order first seen.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @return list<string>
     */
    public function currenciesOf(Collection $lines): array
    {
        /** @var list<string> */
        return $lines
            ->filter(static fn (RecipeVersionLine $line): bool => $line->cost_currency_code !== null && $line->unit_cost_amount !== null)
            ->map(static fn (RecipeVersionLine $line): string => (string) $line->cost_currency_code)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return Collection<int, RecipeVersionLine>
     */
    public function linesOf(RecipeVersion $version): Collection
    {
        /** @var Collection<int, RecipeVersionLine> */
        return RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('line_number')
            ->get();
    }

    /**
     * @param  Collection<int, RecipeVersionLine>  $lines
     *
     * @throws MixedCostCurrency
     */
    private function soleCurrency(Collection $lines): ?string
    {
        $currencies = $this->currenciesOf($lines);

        if (count($currencies) > 1) {
            /** @var list<int> $lineNumbers */
            $lineNumbers = $lines
                ->filter(static fn (RecipeVersionLine $line): bool => $line->cost_currency_code !== null && $line->unit_cost_amount !== null)
                ->map(static fn (RecipeVersionLine $line): int => $line->line_number)
                ->values()
                ->all();

            sort($lineNumbers);

            throw new MixedCostCurrency($currencies, $lineNumbers);
        }

        return $currencies[0] ?? null;
    }

    /**
     * Does the sheet's own wording claim something the version's yield cannot
     * support?
     *
     * Conservative on purpose. A label nobody can classify — "Total", "U.P.",
     * a blank — raises nothing: flagging a mismatch you cannot substantiate
     * teaches a reviewer to ignore the flag, which is the one outcome worse
     * than not having it.
     */
    private function labelContradictsYield(CostComputation $computation, ?string $sourceLabel): bool
    {
        if ($sourceLabel === null || trim($sourceLabel) === '') {
            return false;
        }

        $words = preg_split('/[^a-z]+/', mb_strtolower($sourceLabel), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $claimsPiece = array_intersect($words, self::PIECE_LABEL_WORDS) !== [];
        $claimsMeasured = array_intersect($words, self::MEASURED_LABEL_WORDS) !== [];

        // A label claiming both is itself the contradiction.
        if ($claimsPiece && $claimsMeasured) {
            return true;
        }

        if ($claimsPiece) {
            return $computation->costPerPieceAmount === null;
        }

        if ($claimsMeasured) {
            return $computation->costPerYieldUnitAmount === null;
        }

        return false;
    }

    /**
     * @param  numeric-string  $amount
     * @param  numeric-string  $wastePercent
     * @return numeric-string
     */
    private function withWaste(string $amount, string $wastePercent): string
    {
        $factor = bcadd('1', bcdiv($wastePercent, '100', self::WORKING_SCALE), self::WORKING_SCALE);

        return $this->round(bcmul($amount, $factor, self::WORKING_SCALE));
    }

    /**
     * Round half away from zero to six places.
     *
     * bcmath truncates, which would bias every figure downwards by up to a
     * millionth and make a total disagree with the sum of the lines a human
     * adds up by hand. Adding half a unit in the last place before truncating
     * is the standard correction, and it is done exactly once per figure.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-'.$half : $half, self::SCALE);
    }

    /**
     * Narrow a stored decimal to the numeric string bcmath requires.
     *
     * The columns are `decimal(18,6)` and Eloquent casts them to strings, so
     * in practice every value reaching here is numeric. "In practice" is not a
     * type, and the failure mode is the reason this is a real check rather
     * than a cast: bcmath handed a non-numeric string yields **zero**, not an
     * error, so a malformed value would not blow up — it would quietly make an
     * ingredient free and understate the sheet.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Cost arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
