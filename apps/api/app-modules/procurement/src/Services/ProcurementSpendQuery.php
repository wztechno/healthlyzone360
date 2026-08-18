<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * What the kitchen spent buying stock, by ISO week or by calendar month (§3.7).
 *
 * **One aggregation, because two would disagree.** §3.7 asks for the procurement
 * spend to be extracted and reused "so the monthly report and new weekly/monthly
 * purchase summary cannot disagree", and that is the whole reason this class
 * exists as a collaborator rather than as a second query beside
 * {@see MonthlyCostReportService}. The monthly report's purchasing side is now a
 * month-grouped read of this; the weekly/monthly summary endpoint is a
 * week-or-month-grouped read of the same thing with the same filters. There is
 * one place where "spend" is defined.
 *
 * ## The business date, not the instant
 *
 * Grouping is over `goods_receipts.received_on` — the branch-local calendar day
 * (SUP5). A van unloaded at 21:30 in Dubai is a Tuesday delivery, and grouping
 * money by the UTC instant would move it between weeks depending on where the
 * server is standing. ISO weeks start Monday, which is what `IYYY-"W"IW` returns
 * (`2026-W34`); a month is its plain calendar month (`2026-08`).
 *
 * ## A period, then currencies inside it — never one total across them
 *
 * §3.7 is explicit that figures are never summed across currencies, and it is
 * equally explicit that an unpriced line "contributes to quantity history but not
 * money totals". Those two rules pull in different directions, because **an
 * unpriced line has no currency at all** — there is no bucket to put it in. So
 * the shape is an envelope:
 *
 * - the period carries the completeness facts (`unpriced_line_count`,
 *   `valuation_pending_line_count`, `unpriced_receipt_count`, `is_complete`);
 * - `totals_by_currency` carries only money, one row per currency.
 *
 * A period whose only deliveries are unpriced therefore answers an **empty**
 * `totals_by_currency` and `is_complete: false`. §3.7's "the period is visibly
 * Incomplete" is structural here rather than a flag somebody has to remember to
 * read: there is no money row to mistake for a complete one.
 *
 * ## Priced, settled, and waiting on a rate are three different things
 *
 * - A line with no `line_total_amount` has no money and is **unpriced**: it is
 *   counted, and it contributes nothing to any currency row.
 * - A line whose money is settled carries `costed_at`.
 * - A line whose price is recorded and whose *valuation* was refused for currency
 *   carries `valuation_pending_fx` and a null `costed_at` ({@see ReceiptLineCosting}).
 *   Its money **is** counted — the supplier really charged it — and the period is
 *   still incomplete, because the kitchen's valuation of it is not finished.
 *
 * The two counts are disjoint by construction and their union is exactly the set
 * of lines with a null `costed_at`, which is the same set the **Unpriced
 * receipts** queue works from.
 *
 * ## Header charges are receipt facts, counted once
 *
 * Discount, tax, delivery, other charges and the invoice total live on the
 * receipt, not on its lines, and they are in the receipt's line currency (§3.6 —
 * there is no currency column of their own, deliberately). Summing them off a
 * line join would multiply them by the line count, so they are aggregated in
 * their own query over the receipts in scope. §3.7's rule that item subtotal and
 * full supplier-invoice spend stay separate named values is why they are never
 * folded into `item_subtotal`: tax is not an ingredient's purchase price.
 *
 * A `stock_item_id` filter narrows *lines*; a receipt's charges are a fact about
 * the whole delivery and are not apportioned to one shelf. Under that filter the
 * charges reported are the charges on the receipts those lines came from, counted
 * once each — stated here and in the endpoint description rather than silently
 * spread across items by an arithmetic nobody asked for. `item_subtotal` is
 * unaffected and still reconciles line-for-line to the purchases ledger.
 *
 * ## Cost of the read
 *
 * Three queries, always: the line totals, the header charges and the completeness
 * counts. Each optional breakdown adds exactly one more, grouped one level
 * deeper, so §3.7's "optional supplier and stock-item breakdowns without N+1" is
 * a constant rather than a promise. The `(organisation_id, received_on DESC)`
 * index added with SUP5 is what every one of them reads.
 *
 * @phpstan-type CurrencyTotals array{
 *     currency_code: string,
 *     receipt_count: int,
 *     received_line_count: int,
 *     item_subtotal: numeric-string,
 *     discount_total: numeric-string,
 *     tax_total: numeric-string,
 *     delivery_total: numeric-string,
 *     other_charges_total: numeric-string,
 *     invoice_total: numeric-string|null,
 *     invoiced_receipt_count: int,
 *     by_supplier: list<array<string, mixed>>|null,
 *     by_stock_item: list<array<string, mixed>>|null
 * }
 * @phpstan-type SpendPeriod array{
 *     period: string,
 *     period_start: string,
 *     period_end: string,
 *     totals_by_currency: list<CurrencyTotals>,
 *     receipt_count: int,
 *     unpriced_receipt_count: int,
 *     unpriced_line_count: int,
 *     valuation_pending_line_count: int,
 *     is_complete: bool
 * }
 */
final readonly class ProcurementSpendQuery
{
    /** ISO weeks over `received_on`, Monday-started, labelled `2026-W34`. */
    public const string WEEK = 'week';

    /** Calendar months over `received_on`, labelled `2026-08`. */
    public const string MONTH = 'month';

    /** The two breakdowns §3.7 offers, opt-in so the default payload stays light. */
    public const string INCLUDE_SUPPLIERS = 'suppliers';

    public const string INCLUDE_ITEMS = 'items';

    /** A money field with nothing recorded behind it. `decimal(18,6)`, §4.4. */
    private const string ZERO = '0.000000';

    /**
     * Spend for one organisation, per period and per currency.
     *
     * `$from`/`$to` are inclusive `YYYY-MM-DD` bounds on `received_on`; both are
     * optional here because the monthly cost report is deliberately unbounded
     * over a kitchen's trading history. The bounded window and its cap are the
     * *endpoint's* rule (`ProcurementSpendSummaryController`), not this query's —
     * a cap enforced here would silently truncate the report.
     *
     * @param  array{branch_id?: string|null, supplier_id?: string|null, stock_item_id?: string|null}  $filters
     * @param  list<string>  $include  any of `suppliers`, `items`
     * @return list<SpendPeriod>
     */
    public function forOrganisation(
        string $organisationId,
        string $groupBy,
        ?string $from = null,
        ?string $to = null,
        array $filters = [],
        array $include = [],
    ): array {
        $period = $this->periodExpression($groupBy);

        $lineTotals = $this->lineTotals($organisationId, $period, $from, $to, $filters);
        $charges = $this->headerCharges($organisationId, $period, $from, $to, $filters);
        $completeness = $this->completeness($organisationId, $period, $from, $to, $filters);

        $bySupplier = in_array(self::INCLUDE_SUPPLIERS, $include, true)
            ? $this->supplierBreakdown($organisationId, $period, $from, $to, $filters)
            : [];

        $byStockItem = in_array(self::INCLUDE_ITEMS, $include, true)
            ? $this->stockItemBreakdown($organisationId, $period, $from, $to, $filters)
            : [];

        $keys = array_keys($completeness + $lineTotals + $charges);

        // Newest period first, matching the monthly cost report a manager reads
        // beside this. Both labels are zero-padded, so a string sort is the
        // chronological one.
        rsort($keys);

        $rows = [];

        foreach ($keys as $key) {
            $label = (string) $key;
            $bounds = $this->bounds($groupBy, $label);
            $quality = $completeness[$label] ?? [
                'unpriced_receipt_count' => 0,
                'unpriced_line_count' => 0,
                'valuation_pending_line_count' => 0,
                'receipt_count' => 0,
            ];

            $currencies = array_keys(($lineTotals[$label] ?? []) + ($charges[$label] ?? []));
            sort($currencies);

            $totals = [];

            foreach ($currencies as $currency) {
                $currencyCode = (string) $currency;
                $money = $lineTotals[$label][$currencyCode] ?? null;
                $charge = $charges[$label][$currencyCode] ?? null;

                $totals[] = [
                    'currency_code' => $currencyCode,
                    'receipt_count' => $money['receipt_count'] ?? 0,
                    'received_line_count' => $money['received_line_count'] ?? 0,
                    'item_subtotal' => $money['item_subtotal'] ?? self::ZERO,
                    'discount_total' => $charge['discount_total'] ?? self::ZERO,
                    'tax_total' => $charge['tax_total'] ?? self::ZERO,
                    'delivery_total' => $charge['delivery_total'] ?? self::ZERO,
                    'other_charges_total' => $charge['other_charges_total'] ?? self::ZERO,
                    // Null rather than zero, and the one money field here that is:
                    // a charge nobody recorded is zero money, but "no supplier
                    // invoice total is known for this period" is not a claim that
                    // the invoice was for nothing.
                    'invoice_total' => $charge['invoice_total'] ?? null,
                    'invoiced_receipt_count' => $charge['invoiced_receipt_count'] ?? 0,
                    'by_supplier' => in_array(self::INCLUDE_SUPPLIERS, $include, true)
                        ? ($bySupplier[$label][$currencyCode] ?? [])
                        : null,
                    'by_stock_item' => in_array(self::INCLUDE_ITEMS, $include, true)
                        ? ($byStockItem[$label][$currencyCode] ?? [])
                        : null,
                ];
            }

            $rows[] = [
                'period' => $label,
                'period_start' => $bounds['start'],
                'period_end' => $bounds['end'],
                'totals_by_currency' => $totals,
                'receipt_count' => $quality['receipt_count'],
                'unpriced_receipt_count' => $quality['unpriced_receipt_count'],
                'unpriced_line_count' => $quality['unpriced_line_count'],
                'valuation_pending_line_count' => $quality['valuation_pending_line_count'],
                // Complete means nothing on this period's deliveries is still
                // outstanding: no line missing its price, and none whose valuation
                // is waiting on an exchange-rate decision (§3.6).
                'is_complete' => $quality['unpriced_line_count'] === 0
                    && $quality['valuation_pending_line_count'] === 0,
            ];
        }

        return $rows;
    }

    /* ── the three queries ───────────────────────────────────────────────── */

    /**
     * Σ line totals, line counts and receipt counts per period and currency.
     *
     * The money predicate is the one the monthly cost report has always used —
     * a line total and a currency both present — so the refactor onto this class
     * changes no figure. A `valuation_pending_fx` line satisfies it: the supplier
     * charged that money whether or not the kitchen could value it.
     *
     * @param  literal-string  $period
     * @param  array<string, string|null>  $filters
     * @return array<string, array<string, array{receipt_count: int, received_line_count: int, item_subtotal: numeric-string}>>
     */
    private function lineTotals(string $organisationId, string $period, ?string $from, ?string $to, array $filters): array
    {
        $query = $this->lineQuery($organisationId, $from, $to, $filters)
            ->whereNotNull('goods_receipt_lines.line_total_amount')
            ->whereNotNull('goods_receipt_lines.cost_currency_code')
            ->selectRaw("{$period} as period")
            ->selectRaw('goods_receipt_lines.cost_currency_code as currency')
            ->selectRaw('COUNT(DISTINCT goods_receipt_lines.goods_receipt_id) as receipt_count')
            ->selectRaw('COUNT(*) as line_count')
            ->selectRaw('SUM(goods_receipt_lines.line_total_amount) as item_subtotal')
            ->groupBy('period', 'currency');

        $out = [];

        foreach ($query->get() as $row) {
            $out[(string) $row->getAttribute('period')][(string) $row->getAttribute('currency')] = [
                'receipt_count' => (int) $row->getAttribute('receipt_count'),
                'received_line_count' => (int) $row->getAttribute('line_count'),
                'item_subtotal' => $this->numeric((string) $row->getAttribute('item_subtotal')),
            ];
        }

        return $out;
    }

    /**
     * The receipt-level charges, counted once per receipt.
     *
     * The receipt's currency is read from its own priced lines through a grouped
     * subquery — `MIN` over a set the posting service guarantees has one member
     * (§3.6: every priced line on one receipt is in the same currency). The join
     * is an inner one, so a receipt with no priced line at all contributes no
     * charge row; the posting service refuses a charge on such a receipt anyway,
     * because an amount with no currency is not an amount.
     *
     * @param  literal-string  $period
     * @param  array<string, string|null>  $filters
     * @return array<string, array<string, array{discount_total: numeric-string, tax_total: numeric-string, delivery_total: numeric-string, other_charges_total: numeric-string, invoice_total: numeric-string|null, invoiced_receipt_count: int}>>
     */
    private function headerCharges(string $organisationId, string $period, ?string $from, ?string $to, array $filters): array
    {
        $currencies = DB::table('goods_receipt_lines')
            ->select('goods_receipt_id')
            ->selectRaw('MIN(cost_currency_code) as currency_code')
            ->whereNotNull('cost_currency_code')
            ->groupBy('goods_receipt_id');

        // An explicit, argument-scoped organisation read: this service is also
        // called by the monthly cost report, which must not depend on an ambient
        // tenant context to answer for the organisation it was handed.
        $query = GoodsReceipt::withoutTenancy()
            ->where('goods_receipts.organisation_id', $organisationId)
            ->joinSub($currencies, 'receipt_currency', 'receipt_currency.goods_receipt_id', '=', 'goods_receipts.id')
            ->selectRaw("{$period} as period")
            ->selectRaw('receipt_currency.currency_code as currency')
            ->selectRaw('SUM(goods_receipts.discount_amount) as discount_total')
            ->selectRaw('SUM(goods_receipts.tax_amount) as tax_total')
            ->selectRaw('SUM(goods_receipts.delivery_amount) as delivery_total')
            ->selectRaw('SUM(goods_receipts.other_charges_amount) as other_charges_total')
            ->selectRaw('SUM(goods_receipts.invoice_total_amount) as invoice_total')
            ->selectRaw('COUNT(*) FILTER (WHERE goods_receipts.invoice_total_amount IS NOT NULL) as invoiced_receipt_count')
            ->groupBy('period', 'currency');

        $this->applyReceiptFilters($query, $from, $to, $filters);

        if (($filters['stock_item_id'] ?? null) !== null) {
            $stockItemId = (string) $filters['stock_item_id'];
            $query->whereExists(function ($line) use ($stockItemId): void {
                $line->from('goods_receipt_lines')
                    ->whereColumn('goods_receipt_lines.goods_receipt_id', 'goods_receipts.id')
                    ->where('goods_receipt_lines.stock_item_id', $stockItemId);
            });
        }

        $out = [];

        foreach ($query->get() as $row) {
            $invoiceTotal = $row->getAttribute('invoice_total');

            $out[(string) $row->getAttribute('period')][(string) $row->getAttribute('currency')] = [
                'discount_total' => $this->amount($row->getAttribute('discount_total')),
                'tax_total' => $this->amount($row->getAttribute('tax_total')),
                'delivery_total' => $this->amount($row->getAttribute('delivery_total')),
                'other_charges_total' => $this->amount($row->getAttribute('other_charges_total')),
                'invoice_total' => $invoiceTotal === null ? null : $this->numeric((string) $invoiceTotal),
                'invoiced_receipt_count' => (int) $row->getAttribute('invoiced_receipt_count'),
            ];
        }

        return $out;
    }

    /**
     * The completeness facts, per period and **not** per currency.
     *
     * An unpriced line has no currency to belong to, so this is the one query
     * that must not be grouped by one. `COUNT(… ) FILTER (WHERE …)` keeps all
     * three counts in one pass rather than three round trips over the same rows.
     *
     * @param  literal-string  $period
     * @param  array<string, string|null>  $filters
     * @return array<string, array{receipt_count: int, unpriced_receipt_count: int, unpriced_line_count: int, valuation_pending_line_count: int}>
     */
    private function completeness(string $organisationId, string $period, ?string $from, ?string $to, array $filters): array
    {
        $query = $this->lineQuery($organisationId, $from, $to, $filters)
            ->selectRaw("{$period} as period")
            ->selectRaw('COUNT(DISTINCT goods_receipt_lines.goods_receipt_id) as receipt_count')
            ->selectRaw('COUNT(DISTINCT goods_receipt_lines.goods_receipt_id) FILTER (WHERE goods_receipt_lines.costed_at IS NULL) as unpriced_receipt_count')
            // Disjoint on purpose: a line waiting on an exchange rate has its
            // price recorded, so it is not "unpriced" — it is counted beside it.
            ->selectRaw('COUNT(*) FILTER (WHERE goods_receipt_lines.costed_at IS NULL AND goods_receipt_lines.valuation_pending_fx = false) as unpriced_line_count')
            ->selectRaw('COUNT(*) FILTER (WHERE goods_receipt_lines.valuation_pending_fx) as pending_line_count')
            ->groupBy('period');

        $out = [];

        foreach ($query->get() as $row) {
            $out[(string) $row->getAttribute('period')] = [
                'receipt_count' => (int) $row->getAttribute('receipt_count'),
                'unpriced_receipt_count' => (int) $row->getAttribute('unpriced_receipt_count'),
                'unpriced_line_count' => (int) $row->getAttribute('unpriced_line_count'),
                'valuation_pending_line_count' => (int) $row->getAttribute('pending_line_count'),
            ];
        }

        return $out;
    }

    /* ── the optional breakdowns ─────────────────────────────────────────── */

    /**
     * Item spend per supplier, inside a period and currency — one query.
     *
     * Money and counts only: the header charges are a fact about a whole delivery
     * and are reported once at the currency level rather than divided up here.
     * A `null` supplier is a direct market purchase, which §3.6 keeps as an
     * ordinary case rather than an exception.
     *
     * @param  literal-string  $period
     * @param  array<string, string|null>  $filters
     * @return array<string, array<string, list<array<string, mixed>>>>
     */
    private function supplierBreakdown(string $organisationId, string $period, ?string $from, ?string $to, array $filters): array
    {
        $query = $this->lineQuery($organisationId, $from, $to, $filters)
            ->leftJoin('suppliers', 'suppliers.id', '=', 'goods_receipts.supplier_id')
            ->whereNotNull('goods_receipt_lines.line_total_amount')
            ->whereNotNull('goods_receipt_lines.cost_currency_code')
            ->selectRaw("{$period} as period")
            ->selectRaw('goods_receipt_lines.cost_currency_code as currency')
            ->selectRaw('goods_receipts.supplier_id as supplier_id')
            ->selectRaw('suppliers.code as supplier_code')
            ->selectRaw('suppliers.name_en as supplier_name_en')
            ->selectRaw('COUNT(*) as line_count')
            ->selectRaw('SUM(goods_receipt_lines.line_total_amount) as item_subtotal')
            ->groupBy('period', 'currency', 'goods_receipts.supplier_id', 'suppliers.code', 'suppliers.name_en')
            ->orderByRaw('SUM(goods_receipt_lines.line_total_amount) DESC');

        $out = [];

        foreach ($query->get() as $row) {
            $supplierId = $row->getAttribute('supplier_id');

            $out[(string) $row->getAttribute('period')][(string) $row->getAttribute('currency')][] = [
                'supplier' => $supplierId === null ? null : [
                    'id' => (string) $supplierId,
                    'code' => (string) $row->getAttribute('supplier_code'),
                    'name_en' => (string) $row->getAttribute('supplier_name_en'),
                ],
                'received_line_count' => (int) $row->getAttribute('line_count'),
                'item_subtotal' => $this->numeric((string) $row->getAttribute('item_subtotal')),
            ];
        }

        return $out;
    }

    /**
     * Item spend per stock item, inside a period and currency — one query.
     *
     * @param  literal-string  $period
     * @param  array<string, string|null>  $filters
     * @return array<string, array<string, list<array<string, mixed>>>>
     */
    private function stockItemBreakdown(string $organisationId, string $period, ?string $from, ?string $to, array $filters): array
    {
        $query = $this->lineQuery($organisationId, $from, $to, $filters)
            ->join('stock_items', 'stock_items.id', '=', 'goods_receipt_lines.stock_item_id')
            ->whereNotNull('goods_receipt_lines.line_total_amount')
            ->whereNotNull('goods_receipt_lines.cost_currency_code')
            ->selectRaw("{$period} as period")
            ->selectRaw('goods_receipt_lines.cost_currency_code as currency')
            ->selectRaw('goods_receipt_lines.stock_item_id as stock_item_id')
            ->selectRaw('stock_items.code as item_code')
            ->selectRaw('stock_items.name_en as item_name_en')
            ->selectRaw('COUNT(*) as line_count')
            ->selectRaw('SUM(goods_receipt_lines.line_total_amount) as item_subtotal')
            ->groupBy('period', 'currency', 'goods_receipt_lines.stock_item_id', 'stock_items.code', 'stock_items.name_en')
            ->orderByRaw('SUM(goods_receipt_lines.line_total_amount) DESC');

        $out = [];

        foreach ($query->get() as $row) {
            $out[(string) $row->getAttribute('period')][(string) $row->getAttribute('currency')][] = [
                'stock_item_id' => (string) $row->getAttribute('stock_item_id'),
                'item_code' => (string) $row->getAttribute('item_code'),
                'item_name_en' => (string) $row->getAttribute('item_name_en'),
                'received_line_count' => (int) $row->getAttribute('line_count'),
                'item_subtotal' => $this->numeric((string) $row->getAttribute('item_subtotal')),
            ];
        }

        return $out;
    }

    /* ── shared shape ────────────────────────────────────────────────────── */

    /**
     * Every line of every receipt this organisation owns, narrowed by the filters.
     *
     * The join carries the organisation predicate, so the line model — which has
     * no `organisation_id` of its own and is scoped through its receipt
     * (ADR-0007) — needs no tenancy scope to be safe here.
     *
     * @param  array<string, string|null>  $filters
     * @return Builder<GoodsReceiptLine>
     */
    private function lineQuery(string $organisationId, ?string $from, ?string $to, array $filters): Builder
    {
        $query = GoodsReceiptLine::query()
            ->join('goods_receipts', 'goods_receipts.id', '=', 'goods_receipt_lines.goods_receipt_id')
            ->where('goods_receipts.organisation_id', $organisationId);

        $this->applyReceiptFilters($query, $from, $to, $filters);

        if (($filters['stock_item_id'] ?? null) !== null) {
            $query->where('goods_receipt_lines.stock_item_id', $filters['stock_item_id']);
        }

        return $query;
    }

    /**
     * The branch, supplier and date-range predicates every query shares.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     * @param  array<string, string|null>  $filters
     */
    private function applyReceiptFilters(Builder $query, ?string $from, ?string $to, array $filters): void
    {
        if (($filters['branch_id'] ?? null) !== null) {
            $query->where('goods_receipts.branch_id', $filters['branch_id']);
        }

        if (($filters['supplier_id'] ?? null) !== null) {
            $query->where('goods_receipts.supplier_id', $filters['supplier_id']);
        }

        if ($from !== null) {
            $query->where('goods_receipts.received_on', '>=', $from);
        }

        if ($to !== null) {
            $query->where('goods_receipts.received_on', '<=', $to);
        }
    }

    /**
     * The bucket expression, as a literal so no request value ever reaches SQL
     * unparameterised. An unknown `group_by` is a programming error — the
     * endpoint validates the vocabulary before this is reached — and a silent
     * fallback to months would file a week's money in the wrong place.
     *
     * @return literal-string
     */
    private function periodExpression(string $groupBy): string
    {
        return match ($groupBy) {
            self::WEEK => 'to_char(goods_receipts.received_on, \'IYYY-"W"IW\')',
            self::MONTH => "to_char(goods_receipts.received_on, 'YYYY-MM')",
            default => throw new RuntimeException("Procurement spend cannot be grouped by [{$groupBy}]."),
        };
    }

    /**
     * The calendar days a period label covers, so a reader sees `18–24 Aug`
     * rather than only `2026-W34`.
     *
     * @return array{start: string, end: string}
     */
    private function bounds(string $groupBy, string $label): array
    {
        if ($groupBy === self::WEEK) {
            [$year, $week] = explode('-W', $label);
            $monday = CarbonImmutable::now('UTC')->setISODate((int) $year, (int) $week, 1)->startOfDay();

            return ['start' => $monday->toDateString(), 'end' => $monday->addDays(6)->toDateString()];
        }

        $first = CarbonImmutable::parse($label.'-01', 'UTC');

        return ['start' => $first->toDateString(), 'end' => $first->endOfMonth()->toDateString()];
    }

    /**
     * A summed charge column, where a database null means "nobody recorded one".
     *
     * Zero rather than null, and only for the four charges: a delivery fee nobody
     * wrote down is zero money on the invoice, whereas an absent invoice total is
     * an unknown rather than a zero — which is why that one stays null.
     *
     * @return numeric-string
     */
    private function amount(mixed $value): string
    {
        return $value === null ? self::ZERO : $this->numeric((string) $value);
    }

    /**
     * Narrow a database-read amount before it is published as money, turning a
     * malformed value into a loud failure rather than a silently free figure.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Procurement spend aggregation received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
