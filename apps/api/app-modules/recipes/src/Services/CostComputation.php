<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

/**
 * The result of costing one recipe version — a report first and a snapshot
 * payload second.
 *
 * It is deliberately possible to hold a computation that must never be
 * persisted. A formulation whose third line has no unit cost still has a
 * meaningful partial total, and a kitchen filling costs in over a week wants
 * to see it; what it must not do is become a `recipe_cost_snapshots` row,
 * because a snapshot that silently omits a line is a number that reads as a
 * total and is not one. `isComplete()` is the gate, and
 * `RecipeCostingService::writeSnapshot()` is the only thing that consults it.
 *
 * **Every amount is a string.** Six-decimal major-unit costs (master plan v2
 * §4.4) computed with bcmath, never with floats: `0.1 + 0.2` is not `0.3` in
 * binary floating point, and a cost model whose totals depend on the order the
 * lines happen to be summed in is worse than no cost model.
 */
final readonly class CostComputation
{
    /**
     * @param  string|null  $currencyCode  the single currency the costed lines share; null when nothing is costed
     * @param  array<int, string>  $lineCosts  line number => computed line cost
     * @param  list<int>  $uncostedLineNumbers  lines that contributed nothing, in line order
     */
    public function __construct(
        public ?string $currencyCode,
        public string $totalInputCostAmount,
        public array $lineCosts,
        public array $uncostedLineNumbers,
        public ?string $costPerYieldUnitAmount,
        public ?string $yieldUnitId,
        public ?string $costPerPieceAmount,
        public string $wasteCoefficientPercent,
        public ?string $costPerYieldUnitWithWasteAmount,
        public ?string $costPerPieceWithWasteAmount,
    ) {}

    /**
     * A source technical sheet's own figures, stated verbatim.
     *
     * The K1.8 importer's constructor. There are no lines to report on — the
     * sheet did its own arithmetic and this system is recording the answer,
     * not checking it — so `lineCosts` is empty and `uncostedLineNumbers` is
     * empty, which makes the result complete by construction. That is correct:
     * completeness here means "this is a whole statement", and a sheet's total
     * is a whole statement whatever this system would have computed instead.
     */
    public static function asRecorded(
        string $currencyCode,
        string $totalInputCostAmount,
        string $wasteCoefficientPercent,
        ?string $costPerYieldUnitAmount = null,
        ?string $yieldUnitId = null,
        ?string $costPerPieceAmount = null,
        ?string $costPerYieldUnitWithWasteAmount = null,
        ?string $costPerPieceWithWasteAmount = null,
    ): self {
        return new self(
            currencyCode: $currencyCode,
            totalInputCostAmount: $totalInputCostAmount,
            lineCosts: [],
            uncostedLineNumbers: [],
            costPerYieldUnitAmount: $costPerYieldUnitAmount,
            yieldUnitId: $yieldUnitId,
            costPerPieceAmount: $costPerPieceAmount,
            wasteCoefficientPercent: $wasteCoefficientPercent,
            costPerYieldUnitWithWasteAmount: $costPerYieldUnitWithWasteAmount,
            costPerPieceWithWasteAmount: $costPerPieceWithWasteAmount,
        );
    }

    /**
     * Whether this may be written as a snapshot: every line contributed, and
     * there is a currency for the total to be denominated in.
     */
    public function isComplete(): bool
    {
        return $this->uncostedLineNumbers === [] && $this->currencyCode !== null;
    }

    /**
     * Some lines costed, others not — the state a kitchen is in halfway
     * through pricing a sheet. Reportable, never persistable.
     */
    public function isPartial(): bool
    {
        return $this->lineCosts !== [] && $this->uncostedLineNumbers !== [];
    }
}
