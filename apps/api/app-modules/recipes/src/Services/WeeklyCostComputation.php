<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

/**
 * What a recipe version costs at this week's published prices — the estimating
 * counterpart to the frozen figures on the lines.
 *
 * Two questions, two answers, and they are deliberately both on the technical
 * sheet: *what did we say this cost when we costed it* (the saved line costs and
 * the snapshots) and *what does it cost at what we are actually paying now*.
 * Collapsing them would make one of the two a lie — a sheet costed in March that
 * silently updated, or a live estimate that never moved.
 *
 * `lineSources` is the provenance of every line, present even for lines that
 * could not be costed, because "which ingredient has no price" is the question a
 * kitchen asks the moment the total is withheld.
 */
final readonly class WeeklyCostComputation
{
    /**
     * @param  array<int, WeeklyLineCost>  $lineSources  line number => where its figure came from
     * @param  numeric-string|null  $totalCostPerYieldUnitAmount  formulation + packaging, null unless both halves are complete
     */
    public function __construct(
        public CostComputation $production,
        public PackagingCostComputation $packaging,
        public ?string $totalCostPerYieldUnitAmount,
        public array $lineSources,
        public ?string $weeklyPricePublicationId,
    ) {}

    /**
     * The ingredients on this version with no published price behind them.
     *
     * The initial-price-entry list, and the reason a fallback is not silently
     * treated as good enough: a typed list price is somebody's estimate of what
     * they expect to pay, and the whole point of the weekly average is that it is
     * not that.
     *
     * @return list<string> ingredient ids, in line order, without duplicates
     */
    public function ingredientsNeedingInitialPrice(): array
    {
        $ids = [];

        foreach ($this->lineSources as $source) {
            if ($source->needsInitialPrice()) {
                $ids[$source->ingredientId] = true;
            }
        }

        return array_keys($ids);
    }

    /** Whether any figure on this computation rests on a carried-forward price. */
    public function hasCarriedForwardPrices(): bool
    {
        foreach ($this->lineSources as $source) {
            if ($source->carriedForward) {
                return true;
            }
        }

        return false;
    }
}
