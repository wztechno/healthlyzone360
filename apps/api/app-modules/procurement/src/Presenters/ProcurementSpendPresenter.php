<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

/**
 * The wire shape of one weekly or monthly procurement-spend period (§3.7).
 *
 * **The envelope is the point.** A period carries the completeness facts and a
 * list of per-currency money rows, and the two levels are not a nesting for
 * tidiness: an unpriced line has no currency, so "how much is still missing from
 * this figure" cannot live inside a currency bucket. A period whose deliveries
 * are all unpriced answers an empty `totals_by_currency` and `is_complete:
 * false`, which is §3.7's **Incomplete** made structural — there is no money row
 * for a reader to mistake for a finished one.
 *
 * Every amount is a major-unit decimal string beside its own `currency_code`,
 * and there is no total across currencies anywhere in this shape, because this
 * system has no exchange rate (§4.4). `item_subtotal` and `invoice_total` are
 * kept as separate named values on §3.7's own instruction: tax and delivery are
 * not an ingredient's purchase price, and one figure claiming to be both would
 * mislabel them.
 *
 * **Nothing confidential passes through here.** This is an aggregate of money
 * already visible on the purchases ledger to a reader holding
 * `inventory.view_costs_organisation`; it reads no recipe line, no formulation
 * quantity and no supplier terms.
 */
final class ProcurementSpendPresenter
{
    /**
     * @param  array<string, mixed>  $period
     * @return array<string, mixed>
     */
    public function period(array $period): array
    {
        /** @var list<array<string, mixed>> $totals */
        $totals = $period['totals_by_currency'];

        return [
            'period' => $period['period'],
            'period_start' => $period['period_start'],
            'period_end' => $period['period_end'],
            'receipt_count' => $period['receipt_count'],
            'unpriced_receipt_count' => $period['unpriced_receipt_count'],
            'unpriced_line_count' => $period['unpriced_line_count'],
            'valuation_pending_line_count' => $period['valuation_pending_line_count'],
            'is_complete' => $period['is_complete'],
            'totals_by_currency' => array_map(fn (array $row): array => $this->currency($row), $totals),
        ];
    }

    /**
     * One currency's money inside one period.
     *
     * The two breakdowns are `null` rather than absent when they were not asked
     * for, so a client reads "not requested" as a value rather than as a missing
     * key it has to guess about. An empty list means "requested, and nothing in
     * this bucket".
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function currency(array $row): array
    {
        /** @var list<array<string, mixed>>|null $bySupplier */
        $bySupplier = $row['by_supplier'];
        /** @var list<array<string, mixed>>|null $byStockItem */
        $byStockItem = $row['by_stock_item'];

        return [
            'currency_code' => $row['currency_code'],
            'receipt_count' => $row['receipt_count'],
            'received_line_count' => $row['received_line_count'],
            'item_subtotal' => $row['item_subtotal'],
            'discount_total' => $row['discount_total'],
            'tax_total' => $row['tax_total'],
            'delivery_total' => $row['delivery_total'],
            'other_charges_total' => $row['other_charges_total'],
            'invoice_total' => $row['invoice_total'],
            'invoiced_receipt_count' => $row['invoiced_receipt_count'],
            'by_supplier' => $bySupplier === null
                ? null
                : array_map(fn (array $entry): array => $this->supplierRow($entry), $bySupplier),
            'by_stock_item' => $byStockItem === null
                ? null
                : array_map(fn (array $entry): array => $this->stockItemRow($entry), $byStockItem),
        ];
    }

    /**
     * @param  array<string, mixed>  $entry
     * @return array<string, mixed>
     */
    private function supplierRow(array $entry): array
    {
        return [
            'supplier' => $entry['supplier'],
            'received_line_count' => $entry['received_line_count'],
            'item_subtotal' => $entry['item_subtotal'],
        ];
    }

    /**
     * @param  array<string, mixed>  $entry
     * @return array<string, mixed>
     */
    private function stockItemRow(array $entry): array
    {
        return [
            'stock_item_id' => $entry['stock_item_id'],
            'item_code' => $entry['item_code'],
            'item_name_en' => $entry['item_name_en'],
            'received_line_count' => $entry['received_line_count'],
            'item_subtotal' => $entry['item_subtotal'],
        ];
    }
}
