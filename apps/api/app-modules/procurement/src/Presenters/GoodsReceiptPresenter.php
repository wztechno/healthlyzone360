<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;

/**
 * The wire shapes of a goods receipt, one purchases-ledger line and one row of
 * the unpriced work queue — and the one place the cost redaction lives (INV1.1,
 * §3.6).
 *
 * `$showCosts` is the caller's answer to `inventory.view_costs_organisation`.
 * When it is false every money field is served as `null` and `costs_redacted`
 * is `true`, so a receiving clerk who may record a delivery but not read its
 * valuation sees the quantities and units without the prices — the same split
 * `recipe.view_costs_organisation` draws over a technical sheet. The quantity
 * and unit are never redacted: those are the warehouse facts the clerk entered.
 *
 * **`cost_status` is not redacted, and that is deliberate.** It says whether the
 * paperwork on this delivery is finished; it does not say what anything cost. A
 * receiving clerk chasing an invoice needs to know a receipt is still waiting on
 * one, and hiding that would turn a work state into a secret. The same reasoning
 * keeps `valuation_pending_fx` visible while the price behind it stays hidden.
 *
 * A receipt total is offered only when every priced line shares one currency.
 * There is no exchange rate in this system (§4.4), so a total across two
 * currencies would be a number nobody could reconcile; the honest answer is
 * `null` and a `currency_code` of `null` beside it. The header charges are
 * reported **separately** from the item subtotal for the reason §3.6 gives: tax
 * and delivery are not an ingredient's purchase price, and a screen that added
 * them into one figure would be mislabelling them.
 */
final class GoodsReceiptPresenter
{
    /**
     * One receipt with its lines — the list shape and the base of the detail.
     *
     * @return array<string, mixed>
     */
    public function receipt(GoodsReceipt $receipt, bool $showCosts): array
    {
        /** @var list<GoodsReceiptLine> $lines */
        $lines = $receipt->lines->values()->all();

        $currency = $this->soleCurrency($lines);
        $total = $showCosts ? $this->receiptTotal($lines, $currency) : null;

        return [
            'id' => (string) $receipt->getKey(),
            'branch_id' => (string) $receipt->branch_id,
            'supplier' => $this->supplier($receipt),
            'document_ref' => $receipt->document_ref,
            'supplier_invoice_ref' => $receipt->supplier_invoice_ref,
            'invoice_date' => $receipt->invoice_date?->toDateString(),
            'variance_note' => $receipt->variance_note,
            'purchase_order_id' => $receipt->purchase_order_id,
            'received_at' => $receipt->received_at?->toIso8601String(),
            // The branch-local business day, and what §3.7 groups spend by. A
            // date string rather than a timestamp, because that is exactly the
            // fact it holds.
            'received_on' => $receipt->received_on?->toDateString(),
            'cost_status' => $receipt->cost_status,
            'unpriced_line_count' => $this->unpricedLineCount($lines),
            'valuation_pending_count' => $this->pendingCount($lines),
            'currency_code' => $showCosts ? $currency : null,
            'receipt_total_amount' => $total,
            'discount_amount' => $this->money($receipt->discount_amount, $showCosts),
            'tax_amount' => $this->money($receipt->tax_amount, $showCosts),
            'delivery_amount' => $this->money($receipt->delivery_amount, $showCosts),
            'other_charges_amount' => $this->money($receipt->other_charges_amount, $showCosts),
            'invoice_total_amount' => $this->money($receipt->invoice_total_amount, $showCosts),
            'costs_redacted' => ! $showCosts,
            'lines' => array_map(fn (GoodsReceiptLine $line): array => $this->line($line, $showCosts), $lines),
        ];
    }

    /**
     * One receipt with the order it was delivered against (§6).
     *
     * The order block is a **manage-scoped subset** and §5 permits it
     * deliberately: "the receiving endpoint may expose an issued order's
     * supplier, outstanding items and quantities to a receiver holding
     * `inventory.manage_organisation` without granting the full supply-order
     * book". Its number and its per-line arithmetic are what a person checking a
     * delivery against a sheet of paper needs; the order book's own list stays
     * behind `inventory.order_supplies_organisation`, and there is no money in
     * this block at any depth because there is none on a purchase order at all.
     *
     * @param  array<string, array{ordered: string, received: string, outstanding: string}>  $progress
     * @return array<string, mixed>
     */
    public function detail(GoodsReceipt $receipt, bool $showCosts, ?PurchaseOrder $order, array $progress): array
    {
        return $this->receipt($receipt, $showCosts) + [
            'purchase_order' => $order === null ? null : [
                'id' => (string) $order->getKey(),
                'number' => $order->number,
                'status' => $order->status->value,
                'lines' => $order->lines->map(static fn (PurchaseOrderLine $line): array => [
                    'purchase_order_line_id' => (string) $line->getKey(),
                    'stock_item_id' => (string) $line->stock_item_id,
                    'item_code' => $line->item_code,
                    'item_name_en' => $line->item_name_en,
                    'unit_code' => $line->unit_code,
                    'ordered_quantity' => $progress[(string) $line->getKey()]['ordered'] ?? (string) $line->quantity,
                    'received_quantity' => $progress[(string) $line->getKey()]['received'] ?? '0.0000',
                    'outstanding_quantity' => $progress[(string) $line->getKey()]['outstanding'] ?? '0.0000',
                ])->all(),
            ],
        ];
    }

    /**
     * One row of the **Unpriced receipts** work queue (§3.6).
     *
     * Deliberately not the whole receipt: this is a list somebody scans to
     * decide what to open next, and it carries the two counts that tell them
     * which kind of work each row is. `unpriced_line_count` is "type these
     * prices in"; `valuation_pending_count` is "the prices are already here and
     * an exchange-rate decision is not this screen's to make". A queue that
     * showed one number for both would send people to rows they cannot action.
     *
     * No money at all, at any depth — the amounts belong on the detail, behind
     * the same cost gate this list already sits on.
     *
     * @return array<string, mixed>
     */
    public function queueRow(GoodsReceipt $receipt): array
    {
        /** @var list<GoodsReceiptLine> $lines */
        $lines = $receipt->lines->values()->all();

        return [
            'id' => (string) $receipt->getKey(),
            'received_on' => $receipt->received_on?->toDateString(),
            'supplier' => $this->supplier($receipt),
            'document_ref' => $receipt->document_ref,
            'supplier_invoice_ref' => $receipt->supplier_invoice_ref,
            'purchase_order_id' => $receipt->purchase_order_id,
            'cost_status' => $receipt->cost_status,
            'line_count' => count($lines),
            'unpriced_line_count' => $this->unpricedLineCount($lines),
            'valuation_pending_count' => $this->pendingCount($lines),
        ];
    }

    /**
     * One purchases-ledger row: a receipt line flattened with the date, supplier
     * and item it belongs to. Expects `goodsReceipt`, `goodsReceipt.supplier`
     * and `stockItem` loaded.
     *
     * @return array<string, mixed>
     */
    public function ledgerLine(GoodsReceiptLine $line, bool $showCosts): array
    {
        $receipt = $line->goodsReceipt;
        $stockItem = $line->stockItem;

        return [
            'id' => (string) $line->getKey(),
            'goods_receipt_id' => (string) $line->goods_receipt_id,
            'received_at' => $receipt?->received_at?->toIso8601String(),
            'received_on' => $receipt?->received_on?->toDateString(),
            'supplier' => $receipt instanceof GoodsReceipt ? $this->supplier($receipt) : null,
            'document_ref' => $receipt?->document_ref,
            'purchase_order_id' => $receipt?->purchase_order_id,
            'cost_status' => $receipt?->cost_status,
            'stock_item_id' => (string) $line->stock_item_id,
            'item_code' => $stockItem?->code,
            'item_name_en' => $stockItem?->name_en,
            'ingredient_id' => $stockItem?->ingredient_id,
            'quantity' => (string) $line->quantity,
            'unit_id' => $line->unit_id,
            'unit_price_amount' => $showCosts && $line->unit_price_amount !== null ? (string) $line->unit_price_amount : null,
            'line_total_amount' => $showCosts && $line->line_total_amount !== null ? (string) $line->line_total_amount : null,
            'cost_currency_code' => $showCosts ? $line->cost_currency_code : null,
            'valuation_pending_fx' => $line->valuation_pending_fx,
            'costs_redacted' => ! $showCosts,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function line(GoodsReceiptLine $line, bool $showCosts): array
    {
        return [
            'id' => (string) $line->getKey(),
            'stock_item_id' => (string) $line->stock_item_id,
            'purchase_order_line_id' => $line->purchase_order_line_id,
            'quantity' => (string) $line->quantity,
            'unit_id' => $line->unit_id,
            'unit_price_amount' => $showCosts && $line->unit_price_amount !== null ? (string) $line->unit_price_amount : null,
            'line_total_amount' => $showCosts && $line->line_total_amount !== null ? (string) $line->line_total_amount : null,
            'cost_currency_code' => $showCosts ? $line->cost_currency_code : null,
            // A work state, not a money value: whether this line still needs
            // somebody's attention is not the same question as what it cost.
            'costed_at' => $line->costed_at?->toIso8601String(),
            'valuation_pending_fx' => $line->valuation_pending_fx,
        ];
    }

    /**
     * @return array{id: string, code: string, name_en: string}|null
     */
    private function supplier(GoodsReceipt $receipt): ?array
    {
        $supplier = $receipt->supplier;

        if ($supplier === null) {
            return null;
        }

        return [
            'id' => (string) $supplier->getKey(),
            'code' => (string) $supplier->code,
            'name_en' => (string) $supplier->name_en,
        ];
    }

    /**
     * Lines whose money is not settled — the work the queue exists to list.
     *
     * A line waiting on an exchange rate is counted here too, because its
     * receipt is genuinely not finished; the separate pending count is what says
     * *which* kind of unfinished it is.
     *
     * @param  iterable<GoodsReceiptLine>  $lines
     */
    private function unpricedLineCount(iterable $lines): int
    {
        $count = 0;

        foreach ($lines as $line) {
            if ($line->costed_at === null) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * @param  iterable<GoodsReceiptLine>  $lines
     */
    private function pendingCount(iterable $lines): int
    {
        $count = 0;

        foreach ($lines as $line) {
            if ($line->valuation_pending_fx) {
                $count++;
            }
        }

        return $count;
    }

    private function money(?string $amount, bool $showCosts): ?string
    {
        return $showCosts && $amount !== null ? $amount : null;
    }

    /**
     * @param  iterable<GoodsReceiptLine>  $lines
     */
    private function soleCurrency(iterable $lines): ?string
    {
        $currencies = [];

        foreach ($lines as $line) {
            if ($line->cost_currency_code !== null) {
                $currencies[$line->cost_currency_code] = true;
            }
        }

        return count($currencies) === 1 ? array_key_first($currencies) : null;
    }

    /**
     * @param  iterable<GoodsReceiptLine>  $lines
     * @return numeric-string|null
     */
    private function receiptTotal(iterable $lines, ?string $currency): ?string
    {
        if ($currency === null) {
            return null;
        }

        $total = '0';
        $any = false;

        foreach ($lines as $line) {
            if ($line->line_total_amount !== null && $line->cost_currency_code === $currency) {
                $total = bcadd($total, (string) $line->line_total_amount, 6);
                $any = true;
            }
        }

        return $any ? $total : null;
    }
}
