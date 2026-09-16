<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\IngredientStockCost;
use RuntimeException;

/**
 * What the stock on hand is worth, right now (PROD1).
 *
 * ## A current valuation, and not a period-end one
 *
 * There is no period close anywhere in this system, and this does not invent one.
 * The figure is `Σ quantity_on_hand × moving_average_cost_amount` as those columns
 * stand at the moment of the read — which is the honest thing to publish and a
 * different thing from "what was inventory worth on the 31st". A caller wanting
 * the second would need snapshots nobody takes, and pretending this is that would
 * put a number in a balance sheet that nothing can reconstruct.
 *
 * ## Per currency, and never a single total
 *
 * The house rule, applied again: this system has no exchange-rate source, and a
 * kitchen holding dollar flour and euro oil has two valuations rather than one
 * sum. Adding them would require a rate nobody has chosen.
 *
 * ## Quantity without a value is counted, not zeroed
 *
 * An ingredient with stock and no moving average — never purchased at a recorded
 * price, or a batch that finished `partial` — contributes nothing to the amount
 * and one to `unvalued_item_count`. Valuing it at zero would understate the
 * kitchen's stock silently, which is the direction that matters: a valuation that
 * reads low and complete is worse than one that reads low and says so.
 */
final readonly class InventoryValuationService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /**
     * @return list<array{currency_code: string, value_amount: numeric-string, valued_item_count: int}>
     */
    public function byCurrency(string $organisationId): array
    {
        $rows = IngredientStockCost::query()
            ->where('organisation_id', $organisationId)
            ->whereNotNull('currency_code')
            ->whereNotNull('moving_average_cost_amount')
            ->where('quantity_on_hand', '>', 0)
            ->get(['currency_code', 'quantity_on_hand', 'moving_average_cost_amount']);

        /** @var array<string, array{value: numeric-string, count: int}> $totals */
        $totals = [];

        foreach ($rows as $row) {
            $currency = (string) $row->currency_code;

            $totals[$currency] ??= ['value' => '0', 'count' => 0];

            $totals[$currency]['value'] = bcadd(
                $totals[$currency]['value'],
                bcmul(
                    $this->numeric((string) $row->quantity_on_hand),
                    $this->numeric((string) $row->moving_average_cost_amount),
                    self::WORKING_SCALE,
                ),
                self::WORKING_SCALE,
            );

            $totals[$currency]['count']++;
        }

        ksort($totals);

        $out = [];

        foreach ($totals as $currency => $total) {
            $out[] = [
                'currency_code' => $currency,
                'value_amount' => $this->round($total['value']),
                'valued_item_count' => $total['count'],
            ];
        }

        return $out;
    }

    /**
     * Ingredients holding stock that nothing can value.
     *
     * Counted rather than valued at zero, and published beside the totals rather
     * than folded into them: the amount above is real and **incomplete**, and a
     * reader has to be able to tell that from a kitchen whose shelves are simply
     * emptier than they thought.
     */
    public function unvaluedItemCount(string $organisationId): int
    {
        return IngredientStockCost::query()
            ->where('organisation_id', $organisationId)
            ->where('quantity_on_hand', '>', 0)
            ->where(function ($inner): void {
                $inner->whereNull('moving_average_cost_amount')
                    ->orWhereNull('currency_code');
            })
            ->count();
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Inventory valuation read a non-numeric figure [{$value}].");
        }

        return $value;
    }

    /**
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';

        return bcadd($value, str_starts_with($value, '-') ? '-'.$half : $half, self::SCALE);
    }
}
