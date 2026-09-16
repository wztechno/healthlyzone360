<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Inventory\Services\MealExplosion;
use Healthy360\Production\Models\ProductionOrder;

/**
 * What a batch would need, what the shelves can cover, and what it would cost
 * (PROD1). Writes nothing.
 *
 * The same read/write split {@see MealExplosion}
 * draws: this is a *reading* of a recipe against a branch, which is what lets the
 * planning screen render it, the confirm path reserve against it and a test
 * assert it, without any of the three learning the others' job.
 *
 * ## The cost is withheld rather than partial
 *
 * `estimatedCostAmount` is null whenever any line is uncosted, and
 * `uncostedLines` says which. A total computed over the lines that happened to
 * have prices reads exactly like a complete one and is smaller — which is the
 * direction that gets a kitchen into trouble. The same rule
 * `CostComputation::isComplete()` exists to enforce, applied to a batch.
 *
 * Mixed currencies withhold it too, and for the house reason rather than a new
 * one: this system has no exchange-rate source and must not add unlike money.
 * `currencyConflict` says that happened, so the surface can tell "nobody has
 * priced the flour" from "the flour and the oil are in different currencies".
 */
final readonly class BatchPlan
{
    /**
     * @param  list<BatchPlanLine>  $ingredients
     * @param  list<BatchPlanLine>  $packaging
     * @param  list<array{catalogue_item_id: string|null, reason_code: string, detail: string}>  $failures  ingredients the explosion could not turn into a quantity at all — never folded into the lines as a zero
     * @param  numeric-string|null  $estimatedCostAmount  withheld unless every line is costed in one currency
     * @param  list<string>  $uncostedLines  stock item ids with no usable price
     * @param  numeric-string  $batchFactor
     */
    public function __construct(
        public array $ingredients = [],
        public array $packaging = [],
        public array $failures = [],
        public ?string $estimatedCostAmount = null,
        public ?string $currencyCode = null,
        public array $uncostedLines = [],
        public bool $currencyConflict = false,
        public ?string $weeklyPricePublicationId = null,
        public string $batchFactor = '0',
    ) {}

    /**
     * @return list<BatchPlanLine>
     */
    public function lines(): array
    {
        return [...$this->ingredients, ...$this->packaging];
    }

    /**
     * How many shelves cannot cover their line.
     *
     * A count rather than a boolean, because the desk shows the number and a
     * caller that wanted the boolean can compare it to zero; the reverse is not
     * true.
     */
    public function shortLineCount(): int
    {
        return count(array_filter($this->lines(), static fn (BatchPlanLine $line): bool => $line->isShort()));
    }

    public function isFullyCovered(): bool
    {
        return $this->shortLineCount() === 0;
    }

    /**
     * Whether this plan could be confirmed as it stands.
     *
     * Cost is deliberately **not** part of the answer. The house rule is that a
     * confirm is never refused on cost arithmetic — a kitchen that is about to
     * cook is not blocked because nobody has typed a price for the salt — so an
     * uncosted plan confirms and says its estimate is incomplete.
     * {@see ProductionOrder} carries that forward as the batch's own cost status.
     */
    public function isConfirmable(): bool
    {
        return $this->failures === [] && $this->lines() !== [];
    }
}
