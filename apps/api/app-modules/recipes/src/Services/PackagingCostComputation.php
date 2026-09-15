<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

/**
 * What a version's packaging costs — the second column of the source
 * workbook's cost block.
 *
 * The sheet runs the same three steps over packaging that it runs over raw
 * materials: total the lines, divide by the yield, apply a waste coefficient.
 * The arithmetic is identical, which is why this reuses
 * {@see RecipeCostingService}'s rounding and `withWaste()` rather than
 * restating them; the *inputs* differ, which is why it is a separate type
 * rather than a second call to `computeRecalculated()`.
 *
 * Two of those differences matter enough to name.
 *
 * The waste coefficient is `packaging_waste_percent`, not the version's
 * process waste. They are different losses — sauce left in the pot against
 * mis-fed labels and split film — and the sheet applies different percentages
 * to each.
 *
 * There is no per-piece figure. A per-piece cost divides by the version's
 * piece count, and packaging is already counted per container; dividing a
 * bottle cost by a piece count would produce a figure that means nothing on a
 * version whose pieces and containers are not the same thing.
 *
 * **Every amount is a string**, six-place major-unit decimals computed with
 * bcmath. Same rule as the formulation, same reason: a total that depends on
 * the order the lines were summed in is not a total.
 */
final readonly class PackagingCostComputation
{
    /**
     * @param  string|null  $currencyCode  the single currency the costed lines share; null when nothing is costed
     * @param  array<int, string>  $lineCosts  line number => computed line cost
     * @param  list<int>  $uncostedLineNumbers  lines that contributed nothing, in line order
     */
    public function __construct(
        public ?string $currencyCode,
        public string $totalPackagingCostAmount,
        public array $lineCosts,
        public array $uncostedLineNumbers,
        public ?string $costPerYieldUnitAmount,
        public ?string $yieldUnitId,
        public string $wastePercent,
        public ?string $costPerYieldUnitWithWasteAmount,
    ) {}

    /**
     * A version with no packaging at all: zero, and honestly so.
     *
     * Distinct from a version whose packaging is unpriced, which carries
     * `uncostedLineNumbers` and is *not* complete. A recipe nobody has attached
     * a box to genuinely costs nothing to package; a recipe with a box nobody
     * has priced costs an unknown amount, and totalling that as zero is the
     * error this separation exists to prevent.
     */
    public static function none(): self
    {
        return new self(
            currencyCode: null,
            totalPackagingCostAmount: '0.000000',
            lineCosts: [],
            uncostedLineNumbers: [],
            costPerYieldUnitAmount: null,
            yieldUnitId: null,
            wastePercent: '0.00',
            costPerYieldUnitWithWasteAmount: null,
        );
    }

    /**
     * Whether every packaging line contributed — the gate on adding this to a
     * production cost to make a total.
     *
     * A version with no packaging lines is complete: nothing was omitted. That
     * is why this tests the uncosted list rather than the presence of a
     * currency, which `CostComputation::isComplete()` also has to check because
     * a formulation with no costed lines has no currency to denominate a total
     * in. Here, zero is a currency-free answer that is still an answer.
     */
    public function isComplete(): bool
    {
        return $this->uncostedLineNumbers === [];
    }
}
