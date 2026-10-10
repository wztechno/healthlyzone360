<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Procurement\Enums\WeeklyPriceCarryReason;

/**
 * What one completed week's purchases say one ingredient cost — or why they say
 * nothing.
 *
 * A result object rather than a nullable amount, because "no average" has four
 * distinguishable causes and a kitchen needs to be told which. Three of them are
 * work somebody has to do; one is an ordinary shrug. A bare `null` would collapse
 * all four.
 *
 * `averageUnitAmount` is per `unitId`, which is the ingredient's default unit at
 * the moment the week was computed.
 */
final readonly class WeeklyPriceComputation
{
    /**
     * @param  numeric-string|null  $averageUnitAmount
     * @param  numeric-string|null  $totalQuantity
     * @param  numeric-string|null  $totalCostAmount
     */
    private function __construct(
        public string $ingredientId,
        public ?string $unitId,
        public ?string $averageUnitAmount,
        public ?string $currencyCode,
        public ?string $totalQuantity,
        public ?string $totalCostAmount,
        public int $receiptLineCount,
        public int $unpricedLineCount,
        public ?WeeklyPriceCarryReason $blockedBy,
    ) {}

    /**
     * The week was averaged. `unpricedLineCount` may still be positive — lines
     * whose invoice has not arrived contribute quantity history but no money
     * (§3.7's rule), so an average computed from the priced remainder is real but
     * provisional, and says so through `hasUnpricedLines()`.
     *
     * @param  numeric-string  $averageUnitAmount
     * @param  numeric-string  $totalQuantity
     * @param  numeric-string  $totalCostAmount
     */
    public static function computed(
        string $ingredientId,
        string $unitId,
        string $averageUnitAmount,
        string $currencyCode,
        string $totalQuantity,
        string $totalCostAmount,
        int $receiptLineCount,
        int $unpricedLineCount,
    ): self {
        return new self(
            $ingredientId,
            $unitId,
            $averageUnitAmount,
            $currencyCode,
            $totalQuantity,
            $totalCostAmount,
            $receiptLineCount,
            $unpricedLineCount,
            null,
        );
    }

    /**
     * The week produced no usable average, and why. The caller carries the
     * previous standing price forward, or publishes an unpriced row when there is
     * nothing to carry.
     */
    public static function blocked(
        string $ingredientId,
        WeeklyPriceCarryReason $reason,
        int $receiptLineCount = 0,
        int $unpricedLineCount = 0,
    ): self {
        return new self($ingredientId, null, null, null, null, null, $receiptLineCount, $unpricedLineCount, $reason);
    }

    public function isComputed(): bool
    {
        return $this->blockedBy === null;
    }

    public function hasUnpricedLines(): bool
    {
        return $this->unpricedLineCount > 0;
    }
}
