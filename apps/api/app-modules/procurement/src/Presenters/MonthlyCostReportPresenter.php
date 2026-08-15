<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

/**
 * The wire shape of one monthly cost-report row (INV1.4).
 *
 * A row is one `(month, currency)` pair: spend, COGS, waste, revenue and the
 * margin between revenue and COGS, plus the meal-versus-product revenue **and**
 * COGS splits (INV1.5) and the data-quality flag. Every money field is a
 * major-unit decimal string beside its `currency_code`, never a float and never
 * summed across currencies.
 *
 * **Nothing confidential passes through here.** The report is an aggregate of
 * money already visible on the purchases ledger and the order book to a reader
 * holding `inventory.view_costs_organisation`; it reads no recipe line, no
 * formulation quantity, no supplier terms and no per-ingredient cost. A month is
 * the finest grain — there is no way to read a single dish's cost out of it.
 */
final class MonthlyCostReportPresenter
{
    /**
     * @param  array{
     *     month: string,
     *     currency_code: string,
     *     spend_amount: string,
     *     cogs_amount: string,
     *     waste_amount: string|null,
     *     waste_quantity: string|null,
     *     revenue_amount: string,
     *     gross_margin_amount: string,
     *     gross_margin_percent: string|null,
     *     meal_revenue_amount: string,
     *     product_revenue_amount: string,
     *     other_revenue_amount: string,
     *     meal_cogs_amount: string,
     *     product_cogs_amount: string,
     *     other_cogs_amount: string,
     *     has_data_quality_flag: bool,
     *     exception_count: int
     * }  $row
     * @return array<string, mixed>
     */
    public function row(array $row): array
    {
        return [
            'month' => $row['month'],
            'currency_code' => $row['currency_code'],
            'spend_amount' => $row['spend_amount'],
            'cogs_amount' => $row['cogs_amount'],
            'waste_amount' => $row['waste_amount'],
            'waste_quantity' => $row['waste_quantity'],
            'revenue_amount' => $row['revenue_amount'],
            'gross_margin_amount' => $row['gross_margin_amount'],
            'gross_margin_percent' => $row['gross_margin_percent'],
            'meal_revenue_amount' => $row['meal_revenue_amount'],
            'product_revenue_amount' => $row['product_revenue_amount'],
            'other_revenue_amount' => $row['other_revenue_amount'],
            'meal_cogs_amount' => $row['meal_cogs_amount'],
            'product_cogs_amount' => $row['product_cogs_amount'],
            'other_cogs_amount' => $row['other_cogs_amount'],
            'has_data_quality_flag' => $row['has_data_quality_flag'],
            'exception_count' => $row['exception_count'],
        ];
    }
}
