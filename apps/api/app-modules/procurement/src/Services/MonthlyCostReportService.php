<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\ReferenceData\Models\Currency;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The monthly cost report (INV1.4): a manager's read of one kitchen's economics,
 * month by month — what was spent buying stock, what the food sold cost (COGS),
 * what it sold for (revenue), and the margin between the last two.
 *
 * Nothing here is stored. There is no period-close table: the report is computed
 * live over the same indexed rows the rest of the feature already writes — goods
 * receipt lines (INV1.1), consume/waste movements (INV1.2), and the orders book
 * (C1) — so it can never disagree with the ledgers it reconciles.
 *
 * ## The three amounts and where each is read
 *
 * - **Spend** = Σ `goods_receipt_lines.line_total_amount`, bucketed by the month
 *   of the receipt's `received_at` and grouped by `cost_currency_code`. Major-unit
 *   decimals, the browsable detail behind which is the purchases ledger.
 * - **COGS** = Σ `stock_movements.cost_amount` for `reason = consume` /
 *   `reference_type = order`, bucketed by the movement's `created_at` and grouped
 *   by `cost_currency_code`. Major-unit decimals. A cancelled order's consume is
 *   **excluded** — see below.
 * - **Revenue** = Σ `orders.total_minor` for orders in `confirmed`/`fulfilled`,
 *   bucketed by `confirmed_at` and grouped by `currency_code`. Integer *minor*
 *   units, converted to major for display (see the unit-scale note).
 * - **Waste value** = Σ `stock_movements.cost_amount` for `reason = waste` when a
 *   cost is present; the total wasted *quantity* is reported alongside as the
 *   honest note for the (current) common case where waste carries no cost.
 *
 * ## Cancelled orders are excluded, not netted
 *
 * A cancelled order's original consume movement stays in the append-only ledger;
 * its reversal is an `adjust` / `order_reversal` movement that carries **no cost**
 * (INV1.2), so a numeric net-out is impossible — there is no cost figure to
 * subtract. This report therefore excludes a consume whose order is `cancelled`,
 * joining each consume movement to its order by `reference_id` and dropping the
 * cancelled ones. That is coherent with the revenue side, which counts only
 * `confirmed`/`fulfilled` orders: the same order set drives both figures, so the
 * margin is the margin on food actually sold.
 *
 * ## Month anchors coincide where it matters
 *
 * COGS is bucketed by the consume movement's `created_at` and revenue by the
 * order's `confirmed_at`. The consume movement is written *during* the confirm
 * transaction, so the two timestamps fall in the same month — a sale and the
 * COGS it incurred land in one bucket, which is what makes the monthly margin
 * mean something.
 *
 * ## Unit scale: minor vs major
 *
 * Revenue is `bigint` minor units (a customer receipt figure); spend, COGS and
 * waste are `decimal(18,6)` major units (a valuation figure). They are never
 * summed at different scales: revenue is converted to major by dividing by
 * `10 ^ currency.minor_units` before it sits beside COGS, and the margin is a
 * major-unit subtraction. bcmath throughout — a float would drift a real
 * month's money.
 *
 * ## Never across currencies
 *
 * Every figure is grouped by its currency and a report row is one
 * `(month, currency)` pair. There is no exchange rate in this system (§4.4), so
 * a total across two currencies would be a number nobody could reconcile — the
 * report keeps them on separate rows instead.
 *
 * ## Data quality
 *
 * When a confirmed order could not fully value its consumption — a missing
 * moving-average cost, an unconvertible unit — INV1.2 recorded an
 * {@see OrderConsumptionException} rather than guessing. A month with unresolved
 * exceptions has an **understated** COGS, so the row is flagged rather than
 * presented as authoritative. The flag counts exceptions on non-cancelled orders,
 * anchored on the order's `confirmed_at` month to match the COGS it undermines.
 */
final readonly class MonthlyCostReportService
{
    private const int SCALE = 6;

    private const int PERCENT_SCALE = 2;

    /**
     * Compute the report rows for one organisation, optionally bounded to a month
     * range. `from`/`to` are inclusive `YYYY-MM` bounds on each figure's own
     * anchor month.
     *
     * @return list<array{
     *     month: string,
     *     currency_code: string,
     *     spend_amount: numeric-string,
     *     cogs_amount: numeric-string,
     *     waste_amount: numeric-string|null,
     *     waste_quantity: numeric-string|null,
     *     revenue_amount: numeric-string,
     *     gross_margin_amount: numeric-string,
     *     gross_margin_percent: numeric-string|null,
     *     meal_revenue_amount: numeric-string,
     *     product_revenue_amount: numeric-string,
     *     other_revenue_amount: numeric-string,
     *     meal_cogs_amount: numeric-string,
     *     product_cogs_amount: numeric-string,
     *     other_cogs_amount: numeric-string,
     *     has_data_quality_flag: bool,
     *     exception_count: int
     * }>
     */
    public function forOrganisation(string $organisationId, ?string $from = null, ?string $to = null): array
    {
        $minorUnits = $this->minorUnitsByCurrency();

        $spend = $this->spendByMonthCurrency($organisationId, $from, $to);
        $cogs = $this->cogsByMonthCurrency($organisationId, $from, $to);
        $cogsSplit = $this->cogsSplitByMonthCurrency($organisationId, $from, $to);
        $waste = $this->wasteByMonthCurrency($organisationId, $from, $to);
        $wasteQuantity = $this->wasteQuantityByMonth($organisationId, $from, $to);
        $revenue = $this->revenueByMonthCurrency($organisationId, $from, $to);
        $revenueSplit = $this->revenueSplitByMonthCurrency($organisationId, $from, $to);
        $exceptions = $this->exceptionCountByMonth($organisationId, $from, $to);

        // Union every (month, currency) key any source produced — a month may
        // have spend without a sale, or a sale without a receipt that month.
        $keys = [];
        foreach ([$spend, $cogs, $waste, $revenue] as $source) {
            foreach ($source as $month => $byCurrency) {
                foreach (array_keys($byCurrency) as $currency) {
                    $keys[$month.'|'.$currency] = ['month' => $month, 'currency' => $currency];
                }
            }
        }

        $rows = [];

        foreach ($keys as ['month' => $month, 'currency' => $currency]) {
            $spendAmount = $spend[$month][$currency] ?? '0';
            $cogsAmount = $cogs[$month][$currency] ?? '0';
            $wasteAmount = $waste[$month][$currency] ?? null;

            $revenueMinor = $revenue[$month][$currency] ?? '0';
            $revenueAmount = $this->minorToMajor($revenueMinor, $currency, $minorUnits);

            $split = $revenueSplit[$month][$currency] ?? [];
            $mealRevenue = $this->minorToMajor($split['meal'] ?? '0', $currency, $minorUnits);
            $productRevenue = $this->minorToMajor($split['product'] ?? '0', $currency, $minorUnits);
            $otherRevenue = $this->minorToMajor($split['other'] ?? '0', $currency, $minorUnits);

            // COGS split by line of business, from the consume movements' own
            // `sold_item_type` (INV1.5) — already major-unit decimals, so no
            // minor-to-major scaling. The three buckets sum to `cogs_amount`; a
            // pre-INV1.5 movement with no attribution falls into `other`.
            $cogsBuckets = $cogsSplit[$month][$currency] ?? [];
            $mealCogs = $cogsBuckets['meal'] ?? '0';
            $productCogs = $cogsBuckets['product'] ?? '0';
            $otherCogs = $cogsBuckets['other'] ?? '0';

            $margin = bcsub($revenueAmount, $cogsAmount, self::SCALE);
            $marginPercent = bccomp($revenueAmount, '0', self::SCALE) > 0
                ? bcmul(bcdiv($margin, $revenueAmount, self::SCALE + self::PERCENT_SCALE), '100', self::PERCENT_SCALE)
                : null;

            $exceptionCount = $exceptions[$month] ?? 0;

            $rows[] = [
                'month' => $month,
                'currency_code' => $currency,
                'spend_amount' => $spendAmount,
                'cogs_amount' => $cogsAmount,
                'waste_amount' => $wasteAmount,
                'waste_quantity' => $wasteQuantity[$month] ?? null,
                'revenue_amount' => $revenueAmount,
                'gross_margin_amount' => $margin,
                'gross_margin_percent' => $marginPercent,
                'meal_revenue_amount' => $mealRevenue,
                'product_revenue_amount' => $productRevenue,
                'other_revenue_amount' => $otherRevenue,
                'meal_cogs_amount' => $mealCogs,
                'product_cogs_amount' => $productCogs,
                'other_cogs_amount' => $otherCogs,
                'has_data_quality_flag' => $exceptionCount > 0,
                'exception_count' => $exceptionCount,
            ];
        }

        // Newest month first, then currency, so a manager reads the latest month
        // at the top and a mixed-currency month is stably ordered.
        usort($rows, static function (array $left, array $right): int {
            return $left['month'] === $right['month']
                ? strcmp($left['currency_code'], $right['currency_code'])
                : strcmp($right['month'], $left['month']);
        });

        return $rows;
    }

    /**
     * Spend by month and currency: Σ line totals over the receipt's month.
     *
     * @return array<string, array<string, numeric-string>>
     */
    private function spendByMonthCurrency(string $organisationId, ?string $from, ?string $to): array
    {
        $query = GoodsReceiptLine::query()
            ->join('goods_receipts', 'goods_receipts.id', '=', 'goods_receipt_lines.goods_receipt_id')
            ->where('goods_receipts.organisation_id', $organisationId)
            ->whereNotNull('goods_receipt_lines.line_total_amount')
            ->whereNotNull('goods_receipt_lines.cost_currency_code')
            ->selectRaw("to_char(goods_receipts.received_at, 'YYYY-MM') as month")
            ->selectRaw('goods_receipt_lines.cost_currency_code as currency')
            ->selectRaw('SUM(goods_receipt_lines.line_total_amount) as total')
            ->groupBy('month', 'currency');

        $this->boundMonths($query, "to_char(goods_receipts.received_at, 'YYYY-MM')", $from, $to);

        return $this->pivot($query->get());
    }

    /**
     * COGS by month and currency: Σ consume-movement cost, cancelled orders
     * excluded by a join to the order.
     *
     * @return array<string, array<string, numeric-string>>
     */
    private function cogsByMonthCurrency(string $organisationId, ?string $from, ?string $to): array
    {
        $query = StockMovement::query()
            ->where('stock_movements.organisation_id', $organisationId)
            ->where('stock_movements.reason', 'consume')
            ->where('stock_movements.reference_type', 'order')
            ->whereNotNull('stock_movements.cost_amount')
            ->whereNotNull('stock_movements.cost_currency_code')
            // The consume references its order; a cancelled order's consume is
            // dropped so COGS reflects food actually sold. The reversal carries
            // no cost, so this exclusion — not a numeric net-out — is the join.
            ->join('orders', 'orders.id', '=', DB::raw('stock_movements.reference_id::uuid'))
            ->where('orders.organisation_id', $organisationId)
            ->where('orders.status', '!=', 'cancelled')
            ->selectRaw("to_char(stock_movements.created_at, 'YYYY-MM') as month")
            ->selectRaw('stock_movements.cost_currency_code as currency')
            ->selectRaw('SUM(stock_movements.cost_amount) as total')
            ->groupBy('month', 'currency');

        $this->boundMonths($query, "to_char(stock_movements.created_at, 'YYYY-MM')", $from, $to);

        return $this->pivot($query->get());
    }

    /**
     * COGS split by line of business (meal / product / other) per month and
     * currency (INV1.5): Σ consume-movement cost grouped by the movement's own
     * `sold_item_type`, cancelled orders excluded by the same join to the order.
     *
     * This is the split INV1.4 could not do. A consume movement now records which
     * order line — and which kind of thing — it served (`sold_item_type`,
     * denormalised at consume time), so COGS attributes to a line of business
     * exactly, with no join to `catalogue_items` and no guess at shared
     * ingredients: a product line's COGS is its own moving-average cost, a meal
     * line's is its exploded recipe cost, and the two never blur. A consume
     * predating INV1.5 (or otherwise unattributed) buckets to `other`, so the
     * three always reconcile to `cogsByMonthCurrency`'s total. Major units, bcmath.
     *
     * @return array<string, array<string, array{meal?: numeric-string, product?: numeric-string, other?: numeric-string}>>
     */
    private function cogsSplitByMonthCurrency(string $organisationId, ?string $from, ?string $to): array
    {
        $query = StockMovement::query()
            ->where('stock_movements.organisation_id', $organisationId)
            ->where('stock_movements.reason', 'consume')
            ->where('stock_movements.reference_type', 'order')
            ->whereNotNull('stock_movements.cost_amount')
            ->whereNotNull('stock_movements.cost_currency_code')
            ->join('orders', 'orders.id', '=', DB::raw('stock_movements.reference_id::uuid'))
            ->where('orders.organisation_id', $organisationId)
            ->where('orders.status', '!=', 'cancelled')
            ->selectRaw("to_char(stock_movements.created_at, 'YYYY-MM') as month")
            ->selectRaw('stock_movements.cost_currency_code as currency')
            ->selectRaw('stock_movements.sold_item_type as sold_item_type')
            ->selectRaw('SUM(stock_movements.cost_amount) as total')
            ->groupBy('month', 'currency', 'sold_item_type');

        $this->boundMonths($query, "to_char(stock_movements.created_at, 'YYYY-MM')", $from, $to);

        $out = [];
        foreach ($query->get() as $row) {
            $month = (string) $row->getAttribute('month');
            $currency = (string) $row->getAttribute('currency');
            $bucket = match ((string) $row->getAttribute('sold_item_type')) {
                'meal' => 'meal',
                'product' => 'product',
                default => 'other',
            };
            $out[$month][$currency][$bucket] = bcadd(
                $out[$month][$currency][$bucket] ?? '0',
                $this->numeric((string) $row->getAttribute('total')),
                self::SCALE,
            );
        }

        return $out;
    }

    /**
     * Waste value by month and currency: Σ waste-movement cost, where one is
     * present. Waste that carries no cost contributes nothing here and is
     * surfaced through {@see wasteQuantityByMonth()} instead.
     *
     * @return array<string, array<string, numeric-string>>
     */
    private function wasteByMonthCurrency(string $organisationId, ?string $from, ?string $to): array
    {
        $query = StockMovement::query()
            ->where('stock_movements.organisation_id', $organisationId)
            ->where('stock_movements.reason', 'waste')
            ->whereNotNull('stock_movements.cost_amount')
            ->whereNotNull('stock_movements.cost_currency_code')
            ->selectRaw("to_char(stock_movements.created_at, 'YYYY-MM') as month")
            ->selectRaw('stock_movements.cost_currency_code as currency')
            ->selectRaw('SUM(stock_movements.cost_amount) as total')
            ->groupBy('month', 'currency');

        $this->boundMonths($query, "to_char(stock_movements.created_at, 'YYYY-MM')", $from, $to);

        return $this->pivot($query->get());
    }

    /**
     * Total wasted quantity per month — the honest note when waste carries no
     * cost, so a month's waste is never silently reported as zero value. The
     * stored delta is negative; the magnitude is what a manager reads.
     *
     * @return array<string, numeric-string>
     */
    private function wasteQuantityByMonth(string $organisationId, ?string $from, ?string $to): array
    {
        $query = StockMovement::query()
            ->where('stock_movements.organisation_id', $organisationId)
            ->where('stock_movements.reason', 'waste')
            ->selectRaw("to_char(stock_movements.created_at, 'YYYY-MM') as month")
            ->selectRaw('SUM(ABS(stock_movements.quantity_delta)) as total')
            ->groupBy('month');

        $this->boundMonths($query, "to_char(stock_movements.created_at, 'YYYY-MM')", $from, $to);

        $out = [];
        foreach ($query->get() as $row) {
            $out[(string) $row->getAttribute('month')] = $this->numeric((string) $row->getAttribute('total'));
        }

        return $out;
    }

    /**
     * Revenue by month and currency: Σ order totals (minor units) for
     * confirmed/fulfilled orders, anchored on `confirmed_at`.
     *
     * @return array<string, array<string, numeric-string>>
     */
    private function revenueByMonthCurrency(string $organisationId, ?string $from, ?string $to): array
    {
        $query = Order::query()
            ->where('orders.organisation_id', $organisationId)
            ->whereIn('orders.status', ['confirmed', 'fulfilled'])
            ->whereNotNull('orders.confirmed_at')
            ->selectRaw("to_char(orders.confirmed_at, 'YYYY-MM') as month")
            ->selectRaw('orders.currency_code as currency')
            ->selectRaw('SUM(orders.total_minor) as total')
            ->groupBy('month', 'currency');

        $this->boundMonths($query, "to_char(orders.confirmed_at, 'YYYY-MM')", $from, $to);

        return $this->pivot($query->get());
    }

    /**
     * Revenue split by line of business (meal / product / other) per month and
     * currency, summed from the order lines of confirmed/fulfilled orders.
     *
     * The split is drawn from `order_lines` × `catalogue_items.item_type`, the
     * one place the meal-versus-product distinction is recorded: a consume
     * movement records the order, not the line's item type, so COGS cannot be
     * attributed to a line of business without guessing at shared ingredients —
     * which this report refuses to do. `other` collects subscription-plan lines
     * (the zero-food plan-day line and anything not a meal or product), so the
     * three always reconcile to the order-line subtotal. Minor units.
     *
     * @return array<string, array<string, array{meal?: numeric-string, product?: numeric-string, other?: numeric-string}>>
     */
    private function revenueSplitByMonthCurrency(string $organisationId, ?string $from, ?string $to): array
    {
        $query = OrderLine::query()
            ->join('orders', 'orders.id', '=', 'order_lines.order_id')
            ->join('catalogue_items', 'catalogue_items.id', '=', 'order_lines.catalogue_item_id')
            ->where('orders.organisation_id', $organisationId)
            ->whereIn('orders.status', ['confirmed', 'fulfilled'])
            ->whereNotNull('orders.confirmed_at')
            ->selectRaw("to_char(orders.confirmed_at, 'YYYY-MM') as month")
            ->selectRaw('orders.currency_code as currency')
            ->selectRaw('catalogue_items.item_type as item_type')
            ->selectRaw('SUM(order_lines.line_total_minor) as total')
            ->groupBy('month', 'currency', 'item_type');

        $this->boundMonths($query, "to_char(orders.confirmed_at, 'YYYY-MM')", $from, $to);

        $out = [];
        foreach ($query->get() as $row) {
            $month = (string) $row->getAttribute('month');
            $currency = (string) $row->getAttribute('currency');
            $bucket = match ((string) $row->getAttribute('item_type')) {
                'meal' => 'meal',
                'product' => 'product',
                default => 'other',
            };
            $out[$month][$currency][$bucket] = bcadd(
                $out[$month][$currency][$bucket] ?? '0',
                $this->numeric((string) $row->getAttribute('total')),
                0,
            );
        }

        return $out;
    }

    /**
     * Unresolved consumption exceptions per month, on non-cancelled orders,
     * anchored on the order's `confirmed_at` month so the flag lands on the same
     * month whose COGS it understates.
     *
     * @return array<string, int>
     */
    private function exceptionCountByMonth(string $organisationId, ?string $from, ?string $to): array
    {
        $query = OrderConsumptionException::query()
            ->where('order_consumption_exceptions.organisation_id', $organisationId)
            ->join('orders', 'orders.id', '=', DB::raw('order_consumption_exceptions.order_id::uuid'))
            ->where('orders.organisation_id', $organisationId)
            ->where('orders.status', '!=', 'cancelled')
            ->whereNotNull('orders.confirmed_at')
            ->selectRaw("to_char(orders.confirmed_at, 'YYYY-MM') as month")
            ->selectRaw('COUNT(*) as total')
            ->groupBy('month');

        $this->boundMonths($query, "to_char(orders.confirmed_at, 'YYYY-MM')", $from, $to);

        $out = [];
        foreach ($query->get() as $row) {
            $out[(string) $row->getAttribute('month')] = (int) $row->getAttribute('total');
        }

        return $out;
    }

    /**
     * Apply the inclusive `YYYY-MM` range on a timestamp column, in SQL, so the
     * bound is pushed to the database rather than filtered after the fact. The
     * month expression is a raw expression and the bound a placeholder, so the
     * value is parameterised rather than interpolated.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @param  literal-string  $monthExpression  the `to_char(column, 'YYYY-MM')` bucket expression
     */
    private function boundMonths(Builder $query, string $monthExpression, ?string $from, ?string $to): void
    {
        if ($from !== null) {
            $query->where(DB::raw($monthExpression), '>=', $from);
        }

        if ($to !== null) {
            $query->where(DB::raw($monthExpression), '<=', $to);
        }
    }

    /**
     * Fold a `{month, currency, total}` result set into `month => currency => total`.
     *
     * @param  iterable<Model>  $rows
     * @return array<string, array<string, numeric-string>>
     */
    private function pivot(iterable $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $month = (string) $row->getAttribute('month');
            $currency = (string) $row->getAttribute('currency');
            $out[$month][$currency] = $this->numeric((string) $row->getAttribute('total'));
        }

        return $out;
    }

    /**
     * Narrow a database-read amount to a numeric string before any bcmath, turning
     * a malformed value into a loud failure rather than a silently free figure.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Monthly cost report aggregation received a non-numeric value [{$value}].");
        }

        return $value;
    }

    /**
     * Convert an integer minor-unit amount to a major-unit decimal string using
     * the currency's own minor-unit exponent. Unknown currencies fall back to two
     * places — the ISO default — rather than dividing by one and reporting cents
     * as dollars.
     *
     * @param  numeric-string  $minor
     * @param  array<string, int>  $minorUnits
     * @return numeric-string
     */
    private function minorToMajor(string $minor, string $currency, array $minorUnits): string
    {
        $exponent = $minorUnits[$currency] ?? 2;
        $divisor = bcpow('10', (string) $exponent, 0);

        return bcdiv($minor, $divisor, self::SCALE);
    }

    /**
     * @return array<string, int>
     */
    private function minorUnitsByCurrency(): array
    {
        $out = [];
        foreach (Currency::query()->get(['code', 'minor_units']) as $currency) {
            $out[(string) $currency->code] = (int) $currency->minor_units;
        }

        return $out;
    }
}
