<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;

/**
 * The wire shapes of a goods receipt and of one purchases-ledger line — and the
 * one place the cost redaction lives (INV1.1).
 *
 * `$showCosts` is the caller's answer to `inventory.view_costs_organisation`.
 * When it is false every money field is served as `null` and `costs_redacted`
 * is `true`, so a receiving clerk who may record a delivery but not read its
 * valuation sees the quantities and units without the prices — the same split
 * `recipe.view_costs_organisation` draws over a technical sheet. The quantity
 * and unit are never redacted: those are the warehouse facts the clerk entered.
 *
 * A receipt total is offered only when every priced line shares one currency.
 * There is no exchange rate in this system (§4.4), so a total across two
 * currencies would be a number nobody could reconcile; the honest answer is
 * `null` and a `currency_code` of `null` beside it.
 */
final class GoodsReceiptPresenter
{
    /**
     * @return array{
     *     id: string,
     *     branch_id: string,
     *     supplier: array{id: string, code: string, name_en: string}|null,
     *     document_ref: string|null,
     *     purchase_order_id: string|null,
     *     received_at: string|null,
     *     currency_code: string|null,
     *     receipt_total_amount: string|null,
     *     costs_redacted: bool,
     *     lines: list<array<string, mixed>>
     * }
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
            'purchase_order_id' => $receipt->purchase_order_id,
            'received_at' => $receipt->received_at?->toIso8601String(),
            'currency_code' => $showCosts ? $currency : null,
            'receipt_total_amount' => $total,
            'costs_redacted' => ! $showCosts,
            'lines' => array_map(fn (GoodsReceiptLine $line): array => $this->line($line, $showCosts), $lines),
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
            'supplier' => $receipt instanceof GoodsReceipt ? $this->supplier($receipt) : null,
            'document_ref' => $receipt?->document_ref,
            'stock_item_id' => (string) $line->stock_item_id,
            'item_code' => $stockItem?->code,
            'item_name_en' => $stockItem?->name_en,
            'ingredient_id' => $stockItem?->ingredient_id,
            'quantity' => (string) $line->quantity,
            'unit_id' => $line->unit_id,
            'unit_price_amount' => $showCosts && $line->unit_price_amount !== null ? (string) $line->unit_price_amount : null,
            'line_total_amount' => $showCosts && $line->line_total_amount !== null ? (string) $line->line_total_amount : null,
            'cost_currency_code' => $showCosts ? $line->cost_currency_code : null,
            'costs_redacted' => ! $showCosts,
        ];
    }

    /**
     * @return array{
     *     stock_item_id: string,
     *     quantity: string,
     *     unit_id: string|null,
     *     unit_price_amount: string|null,
     *     line_total_amount: string|null,
     *     cost_currency_code: string|null
     * }
     */
    private function line(GoodsReceiptLine $line, bool $showCosts): array
    {
        return [
            'stock_item_id' => (string) $line->stock_item_id,
            'quantity' => (string) $line->quantity,
            'unit_id' => $line->unit_id,
            'unit_price_amount' => $showCosts && $line->unit_price_amount !== null ? (string) $line->unit_price_amount : null,
            'line_total_amount' => $showCosts && $line->line_total_amount !== null ? (string) $line->line_total_amount : null,
            'cost_currency_code' => $showCosts ? $line->cost_currency_code : null,
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
