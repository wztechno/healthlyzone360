<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;

/**
 * The one wire shape of a supplier.
 *
 * Before this class the list and the create response each hand-rolled their own
 * array, which is how the two drifted: adding a field to the book meant
 * remembering two places, and the second was always the one forgotten. Every
 * supplier the API serves now leaves through `supplier()`, so a list row and a
 * freshly created record are the same object to a client — which is what lets
 * the universal app write one mapper instead of three.
 *
 * `contact_count` and `primary_contact` ride on the canonical shape rather than
 * on the detail variant, because the *list* is what needs them: a supplier book
 * showing "who do I call" beside each name is the screen's whole point, and
 * fetching contacts per row to render it would be the N+1 the summary exists to
 * avoid. Both are served from the loaded `contacts` relation when it is there
 * and counted when it is not, so the caller decides the query shape.
 *
 * `supplied_item_count` rides on the canonical shape for the same reason
 * (SUP2): the book's "Items supplied" column is answered by a `withCount` on
 * the list query, not by loading every link of every supplier to length the
 * array.
 *
 * **The cost redaction lives on the detail, and only on the money.** A supplier
 * record still carries none — the currency it invoices in is a hint the receipt
 * form pre-selects, not an amount — but a supplied item's *last purchase* is
 * real valuation, so `detail()` takes `$showCosts` and nulls
 * `unit_price_amount`/`cost_currency_code` when it is false, exactly as
 * {@see GoodsReceiptPresenter} does. The date, quantity and unit survive
 * redaction on the same grounds they do there: those are warehouse facts a
 * receiving clerk entered, not the valuation the cost permission gates.
 */
final class SupplierPresenter
{
    /**
     * @return array{
     *     id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string|null,
     *     currency_code: string|null,
     *     contact_email: string|null,
     *     contact_phone: string|null,
     *     address: string|null,
     *     payment_terms: string|null,
     *     lead_time_days: int|null,
     *     notes: string|null,
     *     archived_at: string|null,
     *     contact_count: int,
     *     supplied_item_count: int,
     *     primary_contact: array{name: string, phone: string|null}|null
     * }
     */
    public function supplier(Supplier $supplier): array
    {
        $primary = $this->primaryContact($supplier);

        return [
            'id' => (string) $supplier->getKey(),
            'code' => $supplier->code,
            'name_en' => $supplier->name_en,
            'name_ar' => $supplier->name_ar,
            'currency_code' => $supplier->currency_code,
            'contact_email' => $supplier->contact_email,
            'contact_phone' => $supplier->contact_phone,
            'address' => $supplier->address,
            'payment_terms' => $supplier->payment_terms,
            'lead_time_days' => $supplier->lead_time_days,
            'notes' => $supplier->notes,
            'archived_at' => $supplier->archived_at?->toIso8601String(),
            'contact_count' => $this->contactCount($supplier),
            'supplied_item_count' => $this->suppliedItemCount($supplier),
            'primary_contact' => $primary === null ? null : [
                'name' => $primary->name,
                // The number a kitchen actually dials, WhatsApp included: on a
                // list row "who do I call" is the question, and a contact
                // reachable only on WhatsApp is still reachable.
                'phone' => $primary->phone ?? $primary->whatsapp_phone,
            ],
        ];
    }

    /**
     * The canonical shape plus the full contact set and what this supplier
     * sells — the supplier's own page.
     *
     * Expects `contacts` and `suppliedItems.stockItem` loaded; both relations
     * order themselves. `$lastPurchases` is keyed by stock item id and comes
     * from {@see LastPurchasePriceQuery::perSupplierItem()} — one query for the
     * whole section, handed in rather than fetched here, because a presenter
     * that queried per row is precisely the N+1 §3.4 forbids.
     *
     * @param  array<string, array<string, mixed>>  $lastPurchases
     * @return array<string, mixed>
     */
    public function detail(Supplier $supplier, array $lastPurchases = [], bool $showCosts = false): array
    {
        return $this->supplier($supplier) + [
            'contacts' => $supplier->contacts->map(fn (SupplierContact $contact): array => $this->contact($contact))->all(),
            'supplied_items' => $supplier->suppliedItems
                ->map(fn (SupplierStockItem $link): array => $this->suppliedItem(
                    $link,
                    $lastPurchases[(string) $link->stock_item_id] ?? null,
                    $showCosts,
                ))
                ->all(),
            'costs_redacted' => ! $showCosts,
        ];
    }

    /**
     * One "we buy this from them" row (SUP2).
     *
     * The stock item is embedded rather than referenced by id alone because the
     * table beside it shows a name, a code and a unit, and a client resolving
     * three fields per row against a separate item list would be doing a join
     * the server already has open.
     *
     * @param  array<string, mixed>|null  $lastPurchase
     * @return array{
     *     stock_item: array{id: string, code: string, name_en: string, unit_code: string, backing: string}|null,
     *     is_preferred: bool,
     *     supplier_item_ref: string|null,
     *     last_purchase: array<string, mixed>|null
     * }
     */
    public function suppliedItem(SupplierStockItem $link, ?array $lastPurchase, bool $showCosts): array
    {
        $stockItem = $link->stockItem;

        return [
            'stock_item' => $stockItem instanceof StockItem ? [
                'id' => (string) $stockItem->getKey(),
                'code' => $stockItem->code,
                'name_en' => $stockItem->name_en,
                'unit_code' => $stockItem->unit_code,
                // The same field the inventory list publishes, so a client
                // splits the two books here the way it does there.
                'backing' => $stockItem->catalogue_item_id === null ? 'ingredient' : 'product',
            ] : null,
            'is_preferred' => $link->is_preferred,
            'supplier_item_ref' => $link->supplier_item_ref,
            'last_purchase' => $lastPurchase === null ? null : $this->lastPurchase($lastPurchase, $showCosts),
        ];
    }

    /**
     * A last-purchase row with the money redacted when the reader may not read
     * it — the split {@see GoodsReceiptPresenter} draws, restated over the same
     * two fields.
     *
     * `quantity`, `unit_code` and `received_at` are never redacted: what
     * arrived, in what unit and when, are warehouse facts. Only the amount and
     * its currency are the valuation `inventory.view_costs_organisation` gates,
     * and nulling one without the other would leave a number nobody could read.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public function lastPurchase(array $row, bool $showCosts): array
    {
        return [
            'goods_receipt_id' => $row['goods_receipt_id'],
            'document_ref' => $row['document_ref'],
            'received_at' => $row['received_at'],
            'quantity' => $row['quantity'],
            'unit_id' => $row['unit_id'],
            'unit_code' => $row['unit_code'],
            'unit_price_amount' => $showCosts ? $row['unit_price_amount'] : null,
            'cost_currency_code' => $showCosts ? $row['cost_currency_code'] : null,
        ];
    }

    /**
     * One stock item's newest purchase across every supplier (SUP2) — what the
     * stock screen's "Last purchase" column reads.
     *
     * Served by Procurement rather than beside the stock item itself: the
     * inventory list lives in the Inventory module, and Inventory may not
     * import Procurement (the declared module direction). The client joins the
     * two lists on `stock_item_id`, which is why this row carries it.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    public function itemLatestPurchase(string $stockItemId, array $row, bool $showCosts): array
    {
        /** @var array{id: string, code: string, name_en: string}|null $supplier */
        $supplier = $row['supplier'] ?? null;

        return ['stock_item_id' => $stockItemId] + $this->lastPurchase($row, $showCosts) + [
            'supplier' => $supplier,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     name: string,
     *     role_title: string|null,
     *     email: string|null,
     *     phone: string|null,
     *     whatsapp_phone: string|null,
     *     is_primary: bool,
     *     display_order: int
     * }
     */
    public function contact(SupplierContact $contact): array
    {
        return [
            'id' => (string) $contact->getKey(),
            'name' => $contact->name,
            'role_title' => $contact->role_title,
            'email' => $contact->email,
            'phone' => $contact->phone,
            'whatsapp_phone' => $contact->whatsapp_phone,
            'is_primary' => $contact->is_primary,
            'display_order' => $contact->display_order,
        ];
    }

    /**
     * The primary named contact, falling back to the first in display order.
     *
     * The fallback is the honest answer to "who do I call": a supplier whose
     * contacts nobody flagged still has a person at the top of the list, and
     * showing an empty cell beside a supplier with three contacts on file would
     * be a worse answer than showing the first of them.
     */
    private function primaryContact(Supplier $supplier): ?SupplierContact
    {
        if (! $supplier->relationLoaded('contacts')) {
            return SupplierContact::query()
                ->where('supplier_id', $supplier->getKey())
                ->orderByDesc('is_primary')
                ->orderBy('display_order')
                ->orderBy('name')
                ->first();
        }

        return $supplier->contacts->firstWhere('is_primary', true)
            ?? $supplier->contacts->first();
    }

    private function contactCount(Supplier $supplier): int
    {
        if ($supplier->relationLoaded('contacts')) {
            return $supplier->contacts->count();
        }

        $counted = $supplier->getAttribute('contacts_count');

        return is_numeric($counted)
            ? (int) $counted
            : SupplierContact::query()->where('supplier_id', $supplier->getKey())->count();
    }

    /**
     * How many shelves this supplier sells (SUP2).
     *
     * The loaded relation first, then the `withCount` the list query attaches,
     * and a count query only when neither is there — a freshly created supplier
     * answered by the store controller, which has nothing loaded and no links
     * to count. The order matters: reversing it would make the book's read one
     * query per row, which is the thing the count exists to avoid.
     */
    private function suppliedItemCount(Supplier $supplier): int
    {
        if ($supplier->relationLoaded('suppliedItems')) {
            return $supplier->suppliedItems->count();
        }

        $counted = $supplier->getAttribute('supplied_items_count');

        return is_numeric($counted)
            ? (int) $counted
            : SupplierStockItem::query()->where('supplier_id', $supplier->getKey())->count();
    }
}
