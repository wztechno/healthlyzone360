<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

/**
 * The wire shape of one monthly cost-report row (INV1.4).
 *
 * A row is one `(month, currency)` pair: spend, COGS, waste, revenue and the
 * margin between revenue and COGS, plus the meal-versus-product revenue **and**
 * COGS splits (INV1.5) and the two data-quality flags. Every money field is a
 * major-unit decimal string beside its `currency_code`, never a float and never
 * summed across currencies.
 *
 * The two flags answer two different questions and are never merged.
 * `has_data_quality_flag`/`exception_count` say the month's **COGS** is
 * understated by unresolved consumption exceptions (INV1.2).
 * `is_spend_complete`/`unpriced_line_count`/`valuation_pending_line_count` say
 * the month's **spend** is understated because a delivery's invoice has not been
 * entered, or because a recorded price could not be valued in the ingredient's
 * currency (SUP6, §3.6). Those three are month facts rather than currency facts —
 * an unpriced line has no currency — so, like `waste_quantity`, they repeat
 * across a month's currency rows.
 *
 * **Nothing confidential passes through here.** The report is an aggregate of
 * money already visible on the purchases ledger and the order book to a reader
 * holding `inventory.view_costs_organisation`; it reads no recipe line, no
 * formulation quantity, no supplier terms and no per-ingredient cost. A month is
 * the finest grain — there is no way to read a single dish's cost out of it.
 *
 * ## Three production figures and three completeness flags, none of which sums
 *
 * `production_consumption_amount` is **not** inside `cogs_amount` — COGS joins to
 * an order and a batch has none, so flour that became dressing has not been sold
 * yet. `production_waste_amount` **is** inside `waste_amount`, published as an
 * "of which" breakdown rather than an addition, because the waste row already
 * counted it. `production_yield_value_amount` is **neither revenue nor expense**:
 * it is money moving from raw materials into finished goods, the same figure on
 * both sides of the shelf, named so nobody adds it to anything.
 *
 * The flags undermine three different numbers and stay apart for that reason:
 * `is_spend_complete` says what a month cost to buy is understated,
 * `has_data_quality_flag` says what it cost to sell is, and
 * `is_production_valuation_complete` says what it cost to *make* is. One flag
 * covering all three would tell a reader something is wrong and not what.
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
     *     production_consumption_amount: string,
     *     production_waste_amount: string,
     *     production_yield_value_amount: string,
     *     estimated_cogs_amount: string|null,
     *     estimated_margin_amount: string|null,
     *     estimated_margin_percent: string|null,
     *     unestimated_line_count: int,
     *     is_estimate_complete: bool,
     *     has_data_quality_flag: bool,
     *     exception_count: int,
     *     is_spend_complete: bool,
     *     unpriced_line_count: int,
     *     valuation_pending_line_count: int,
     *     is_production_valuation_complete: bool,
     *     unvalued_batch_count: int
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
            'production_consumption_amount' => $row['production_consumption_amount'],
            'production_waste_amount' => $row['production_waste_amount'],
            'production_yield_value_amount' => $row['production_yield_value_amount'],
            'estimated_cogs_amount' => $row['estimated_cogs_amount'],
            'estimated_margin_amount' => $row['estimated_margin_amount'],
            'estimated_margin_percent' => $row['estimated_margin_percent'],
            'unestimated_line_count' => $row['unestimated_line_count'],
            'is_estimate_complete' => $row['is_estimate_complete'],
            'has_data_quality_flag' => $row['has_data_quality_flag'],
            'exception_count' => $row['exception_count'],
            'is_spend_complete' => $row['is_spend_complete'],
            'unpriced_line_count' => $row['unpriced_line_count'],
            'valuation_pending_line_count' => $row['valuation_pending_line_count'],
            'is_production_valuation_complete' => $row['is_production_valuation_complete'],
            'unvalued_batch_count' => $row['unvalued_batch_count'],
        ];
    }
}
