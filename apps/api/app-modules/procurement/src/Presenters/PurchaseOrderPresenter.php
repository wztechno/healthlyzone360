<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\Procurement\Models\Supplier;

/**
 * The one wire shape of a purchase order (§3.5).
 *
 * **One shape for the list, the detail and the create response**, on the same
 * grounds {@see SupplierPresenter} gives: a second "summary" variant is the one
 * that drifts, and the two consumers that would justify one both want the whole
 * thing anyway. The order book's list is what slice 7's print batch reads — an
 * `ids[]` request answered with full lines — so a list row without lines would
 * force print to make a second round trip per order.
 *
 * ## Two suppliers on every issued order, and that is the design
 *
 * `supplier` is the **live** record: the supplier as it stands right now, with
 * its archive flag, because a screen offering to issue an order needs to know
 * whether the supplier is still in the book. `recipient_snapshot` is who the
 * document was **addressed to** at the instant it was issued, and it is `null`
 * on a draft because a draft has been addressed to nobody yet.
 *
 * §3.5 draws the rule the two implement: draft previews use current supplier
 * data, issued reprints use the snapshot. A supplier that moved premises in
 * March must not silently rewrite the February order it is holding a copy of —
 * and equally, a person looking at that February order must still be able to see
 * that the supplier has since been archived.
 *
 * ## There is no money in this shape, at any depth
 *
 * Not a price, not an amount, not a currency, not a total — on the order, on a
 * line, or inside the snapshot. §3.5 puts actual prices on the *receipt*, where
 * each partial delivery carries the figure it was really invoiced at, and a
 * structural test asserts that no key in any purchase-order response matches
 * `amount|price|cost|currency`. Cost-authorised screens may fetch the last
 * historical receipt price separately, from the endpoint that already gates it.
 */
final class PurchaseOrderPresenter
{
    /**
     * Expects `lines`, `supplier`, `branch` and `goodsReceipts` loaded — one
     * eager load for the whole page, never a query per row.
     *
     * `$progress` is {@see ReceivedQuantityQuery}'s answer for every line on this
     * order, computed once for the whole page. It is a parameter rather than
     * something the presenter fetches for itself precisely so that a list of
     * twenty-five orders costs one query rather than twenty-five.
     *
     * @param  array<string, array{ordered: string, received: string, outstanding: string}>  $progress
     * @return array<string, mixed>
     */
    public function purchaseOrder(PurchaseOrder $order, array $progress = []): array
    {
        $lines = $order->lines;

        return [
            'id' => (string) $order->getKey(),
            'number' => $order->number,
            'status' => $order->status->value,
            'branch' => $this->branch($order),
            'supplier' => $this->supplier($order),
            // Null on a draft, and the client renders the live supplier there.
            // Present from `issued` onward, and the client renders *this*.
            'recipient_snapshot' => $order->recipient_snapshot,
            'notes' => $order->notes,
            'line_count' => $lines->count(),
            'issued_at' => $order->issued_at?->toIso8601String(),
            // Set only when the last outstanding line actually arrived. An order
            // closed short reaches `received` with this still null and
            // `closed_at` set instead: nothing was last fulfilled, and a date
            // here would be a small lie in the one place a person checks.
            'received_at' => $order->received_at?->toIso8601String(),
            'closed_at' => $order->closed_at?->toIso8601String(),
            'close_short_reason' => $order->close_short_reason,
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'created_at' => $order->created_at?->toIso8601String(),
            'lines' => $lines->map(fn (PurchaseOrderLine $line): array => $this->line($line, $progress))->all(),
            'receipts' => $this->receipts($order),
        ];
    }

    /**
     * Every delivery made against this order, oldest first (§3.5).
     *
     * A reference rather than the receipt itself: the date, the delivery note and
     * how many lines it carried are what an order detail lists, and the money on
     * those lines is behind a permission this response does not check. A client
     * that wants the figures opens the receipt, where the cost gate applies.
     *
     * @return list<array{id: string, received_on: string|null, document_ref: string|null, line_count: int}>
     */
    private function receipts(PurchaseOrder $order): array
    {
        return array_values($order->goodsReceipts->map(static fn (GoodsReceipt $receipt): array => [
            'id' => (string) $receipt->getKey(),
            'received_on' => $receipt->received_on?->toDateString(),
            'document_ref' => $receipt->document_ref,
            'line_count' => $receipt->lines->count(),
        ])->all());
    }

    /**
     * One requested shelf, as the document says it.
     *
     * Every display field is the **snapshot** on the line rather than a read
     * through to the stock item: that is what makes an issued order immutable in
     * practice rather than only in status. `stock_item_id` rides alongside so a
     * client can deep-link to the shelf and so slice 5 can match a receipt line
     * to this one — a pointer, never the source of the label beside it.
     *
     * `received_quantity` and `outstanding_quantity` are quantities, not money,
     * and they sit here because §3.5 has the detail show ordered, received and
     * outstanding quantities per line. All three are expressed in the line's own
     * `unit_code`: a delivery quoted per kilogram against a shelf counted in
     * grams is converted before it is summed, so the figures on one row always
     * add up.
     *
     * `outstanding_quantity` is floored at zero. An over-receipt is a real event
     * and its variance note records it; a negative amount still to come would be
     * an arithmetic curiosity rather than an instruction.
     *
     * @param  array<string, array{ordered: string, received: string, outstanding: string}>  $progress
     * @return array{
     *     id: string,
     *     stock_item_id: string,
     *     item_code: string,
     *     item_name_en: string,
     *     item_name_ar: string|null,
     *     quantity: string,
     *     received_quantity: string,
     *     outstanding_quantity: string,
     *     unit_code: string,
     *     supplier_item_ref: string|null,
     *     notes: string|null,
     *     display_order: int
     * }
     */
    public function line(PurchaseOrderLine $line, array $progress = []): array
    {
        $row = $progress[(string) $line->getKey()] ?? null;

        return [
            'id' => (string) $line->getKey(),
            'stock_item_id' => (string) $line->stock_item_id,
            'item_code' => $line->item_code,
            'item_name_en' => $line->item_name_en,
            'item_name_ar' => $line->item_name_ar,
            // A decimal string at scale 4, never a float: a kitchen ordering
            // 0.125 kg of saffron means it, and a float round trip is how that
            // becomes 0.12499999999999999.
            'quantity' => (string) $line->quantity,
            'received_quantity' => $row['received'] ?? '0.0000',
            'outstanding_quantity' => $row['outstanding'] ?? (string) $line->quantity,
            'unit_code' => $line->unit_code,
            'supplier_item_ref' => $line->supplier_item_ref,
            'notes' => $line->notes,
            'display_order' => $line->display_order,
        ];
    }

    /**
     * The live supplier reference.
     *
     * `archived_at` is on it deliberately: an issued order for a since-archived
     * supplier is an ordinary situation the detail screen has to explain, and a
     * reference without the flag would leave the screen guessing why Issue is
     * refused. `code` rides along because every other supplier-bearing shape in
     * this API carries it, and a list naming two similarly-named suppliers
     * without their codes is a list a kitchen cannot read.
     *
     * @return array{id: string, code: string, name_en: string, name_ar: string|null, archived_at: string|null}|null
     */
    private function supplier(PurchaseOrder $order): ?array
    {
        $supplier = $order->supplier;

        if (! $supplier instanceof Supplier) {
            return null;
        }

        return [
            'id' => (string) $supplier->getKey(),
            'code' => $supplier->code,
            'name_en' => $supplier->name_en,
            'name_ar' => $supplier->name_ar,
            'archived_at' => $supplier->archived_at?->toIso8601String(),
        ];
    }

    /**
     * The branch that is short of the goods.
     *
     * `name` rather than `name_en`: `organisation_branches` carries a single
     * name column, and inventing a bilingual pair on the wire would promise an
     * Arabic branch name the table has no room for.
     *
     * @return array{id: string, name: string}|null
     */
    private function branch(PurchaseOrder $order): ?array
    {
        $branch = $order->branch;

        if (! $branch instanceof OrganisationBranch) {
            return null;
        }

        return [
            'id' => (string) $branch->getKey(),
            'name' => $branch->name,
        ];
    }
}
