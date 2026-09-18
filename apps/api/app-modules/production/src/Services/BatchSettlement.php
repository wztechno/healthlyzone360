<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Models\ProductionOrderLine;

/**
 * What a completing batch adds up to, accumulated line by line (PROD1).
 *
 * Mutable, unlike every other object in this module, and deliberately: it is a
 * running total inside one transaction rather than a value anybody stores or
 * passes around. The alternative — rebuilding an immutable total per line — would
 * be twelve allocations to say what one addition says.
 *
 * ## Three cost states, and the middle one is the point
 *
 * - `complete` — every input that moved had a valued cost, all in one currency.
 * - `partial` — at least one input contributed quantity and no money. The total
 *   is real and **too small**, so the unit cost is withheld rather than published:
 *   a partial total reads exactly like a complete one, and reading it as complete
 *   is how a kitchen prices a dish below what it cost to make.
 * - `unvalued` — the inputs disagree about currency. This system has no
 *   exchange-rate source and refuses to add unlike money rather than inventing a
 *   rate, so there is no total at all.
 *
 * ## Input waste is totalled apart from consumption
 *
 * They are two different facts with two different readers: consumption becomes
 * the batch's cost and then the cost of goods, while waste is reported as waste.
 * A single total would put the flour somebody dropped into the price of the
 * bread.
 */
final class BatchSettlement
{
    /** @var numeric-string */
    public string $consumedCost = '0';

    /** @var numeric-string */
    public string $wasteCost = '0';

    public ?string $currencyCode = null;

    /** @var list<string> */
    private array $notes = [];

    private bool $hasUnvaluedInput = false;

    private bool $currencyConflict = false;

    private bool $degradedToPartial = false;

    /**
     * @param  numeric-string  $consumed
     * @param  numeric-string  $waste
     */
    public function add(
        ProductionOrderLine $line,
        string $consumed,
        string $waste,
        ?InputValuation $valuation,
        bool $producedNothing,
    ): void {
        $moved = bcadd($consumed, $waste, 4);

        if (bccomp($moved, '0', 4) <= 0) {
            // A line that took nothing says nothing about whether the batch can
            // be valued. Counting it as unvalued would make a recipe with an
            // optional garnish permanently `partial`.
            return;
        }

        if ($valuation === null) {
            $this->hasUnvaluedInput = true;
            $this->notes[] = 'No cost is recorded for stock item '.$line->stock_item_id.', so its part of the batch is unvalued.';

            return;
        }

        if ($this->currencyCode === null) {
            $this->currencyCode = $valuation->currencyCode;
        } elseif ($this->currencyCode !== $valuation->currencyCode) {
            $this->currencyConflict = true;
            $this->notes[] = 'Inputs are costed in more than one currency, which this system does not convert between.';
        }

        // A batch that produced nothing transformed nothing: everything it took
        // is loss, so it belongs in the waste total rather than the cost of what
        // was made.
        $consumedCost = bcmul($producedNothing ? '0' : $consumed, $valuation->unitCostAmount, 12);
        $wasteBase = $producedNothing ? $moved : $waste;

        $this->consumedCost = bcadd($this->consumedCost, $consumedCost, 12);
        $this->wasteCost = bcadd($this->wasteCost, bcmul($wasteBase, $valuation->unitCostAmount, 12), 12);
    }

    /**
     * Force the batch down to `partial` without a missing input.
     *
     * The one caller is the finished-goods blend: a batch whose yield could not be
     * blended has a real input total and a valuation that did not land, and saying
     * `complete` would claim the average moved when it did not.
     */
    public function degrade(string $status): void
    {
        if ($status === ProductionOrder::COST_PARTIAL) {
            $this->degradedToPartial = true;
        }
    }

    public function note(string $note): void
    {
        $this->notes[] = $note;
    }

    /**
     * @return 'complete'|'partial'|'unvalued'
     */
    public function status(): string
    {
        if ($this->currencyConflict) {
            return ProductionOrder::COST_UNVALUED;
        }

        if ($this->currencyCode === null) {
            // Nothing was valued at all. Not `partial`, which implies part of it
            // was: there is no total here to be part of.
            return ProductionOrder::COST_UNVALUED;
        }

        if ($this->hasUnvaluedInput || $this->degradedToPartial) {
            return ProductionOrder::COST_PARTIAL;
        }

        return ProductionOrder::COST_COMPLETE;
    }

    /**
     * Why the cost is not complete, in the words a reader needs, or null when it
     * is.
     */
    public function noteText(): ?string
    {
        if ($this->notes === []) {
            return null;
        }

        return mb_substr(implode(' ', array_unique($this->notes)), 0, 255);
    }
}
