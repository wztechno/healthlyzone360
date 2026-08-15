<?php

declare(strict_types=1);

namespace Healthy360\Orders\Presenters;

use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Models\OrderPaymentReceipt;

/**
 * The two wire shapes of an order, built separately on purpose.
 *
 * **Neither shape is the other with fields removed.** `customer()` and
 * `kitchen()` construct their arrays independently, and the duplication is the
 * point — it is the same rule `CatalogueItemAdminPresenter` states about its
 * absent public projection. A narrow shape produced by unsetting keys from a
 * wide one is one careless refactor away from leaking: somebody adds a column
 * to the wide array, the subtraction list is not updated, and a price list
 * identifier appears on a receipt. Here, a new column reaches a customer only
 * if somebody writes it into the customer method, which is a decision rather
 * than an oversight.
 *
 * ## What a customer is never shown, and why each one
 *
 * * **`price_list_id`, `price_list_item_id`** — the snapshot's provenance.
 *   They exist so that "why was this the price?" is answerable a year later,
 *   and `OrderLine` classifies them `Internal` for exactly that reason. On a
 *   receipt they would name a kitchen's tariff structure to the person being
 *   charged by it — and on a B2B or agreement list, one customer's negotiated
 *   position is reconstructable from which list priced their line.
 * * **`organisation_id`** — the seller's internal key. The customer bought
 *   from a kitchen, not from a UUID, and an identifier is not an answer to
 *   "who cooked this". *That the customer-facing shape carries no kitchen
 *   identity at all is a stated gap*: naming the kitchen means a public
 *   projection of an organisation, which is M1's marketplace surface and not
 *   this slice's to invent.
 * * **`created_by`** — the user who transacted the placement. For a
 *   self-service order that is the customer themselves and says nothing; for
 *   an order placed by staff it names an employee to a member of the public.
 * * **`lock_version`** — the optimistic-concurrency validator of a resource
 *   the customer cannot write. Serving a validator with no writer is an
 *   invitation to send `If-Match` at an endpoint that would ignore it.
 * * **`branch_id`, `sales_channel_id`, `delivery_zone_id`** — where the food
 *   was made, which route to market took the money, and which slice of the
 *   delivery map the address fell into. All three are the kitchen's operating
 *   arrangements; none of them changes anything the customer can do.
 *
 * The **amounts are shown to both**, and that is not an oversight either.
 * `Order` classifies them `Internal` rather than `Confidential` because what
 * somebody was charged is printed on their own receipt; what the food *cost*
 * the kitchen is the confidential figure, and no column on either table carries
 * it.
 *
 * The **allergen list is shown to both**, exactly as `OrderPlacementService`
 * snapshotted it: code and containment, never the derivation or the source
 * ingredient. It is what the customer was told the food contains, and an order
 * line is the most likely row on the platform to be handed to a courier.
 *
 * ## The two payment shapes live here as well
 *
 * `paymentReceipt()` and `paymentSummary()` are kitchen-side shapes for an
 * order's money, and they are here rather than in a presenter of their own for
 * one reason: **two surfaces serve them and neither owns them.** The desk's
 * receipt endpoint returns both, and `OrderDeskPresenter` puts the summary on
 * every queue row. A shape defined at one of those two call sites would be
 * imported by the other, which is how a queue row and a receipt response start
 * disagreeing about what `receipted` means.
 *
 * Neither is a customer shape and neither ever will be. What a kitchen has been
 * paid is the kitchen's ledger; what the customer owes is their order total,
 * which the customer shape already carries.
 */
final class OrderPresenter
{
    /**
     * The receipt.
     *
     * @param  iterable<int, OrderLine>  $lines
     * @return array{
     *     id: string,
     *     order_number: string,
     *     status: string,
     *     currency_code: string,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     payment_method: string,
     *     delivery: array{
     *         label: string|null,
     *         line_one: string,
     *         line_two: string|null,
     *         city: string|null,
     *         area_name_en: string|null,
     *         area_name_ar: string|null,
     *         area_id: string|null,
     *         window_code: string|null,
     *         requested_date: string|null
     *     },
     *     placed_at: string,
     *     confirmed_at: string|null,
     *     fulfilled_at: string|null,
     *     cancelled_at: string|null,
     *     cancellation_reason: string|null,
     *     line_count: int,
     *     lines: list<array{
     *         id: string,
     *         catalogue_item_id: string,
     *         catalogue_item_variant_id: string|null,
     *         name_en: string,
     *         name_ar: string,
     *         variant_label: string|null,
     *         quantity: string,
     *         unit_price_minor: int,
     *         line_total_minor: int,
     *         currency_code: string,
     *         allergens: list<array{allergen_code: string, containment: string}>,
     *         pack_summary: array<string, mixed>|null
     *     }>,
     *     created_at: string|null
     * }
     */
    public function customer(Order $order, iterable $lines): array
    {
        $presented = [];

        foreach ($lines as $line) {
            $presented[] = $this->customerLine($line);
        }

        return [
            'id' => (string) $order->getKey(),
            'order_number' => $order->order_number,
            'status' => $order->status->value,
            'currency_code' => $order->currency_code,
            'subtotal_minor' => $order->subtotal_minor,
            'delivery_fee_minor' => $order->delivery_fee_minor,
            'total_minor' => $order->total_minor,
            'payment_method' => $order->payment_method->value,
            'delivery' => [
                'label' => $order->delivery_label,
                'line_one' => $order->delivery_line_one,
                'line_two' => $order->delivery_line_two,
                'city' => $order->delivery_city,
                'area_name_en' => $order->delivery_area_name_en,
                'area_name_ar' => $order->delivery_area_name_ar,
                'area_id' => $order->delivery_area_id,
                'window_code' => $order->delivery_window_code,
                'requested_date' => $order->requested_delivery_date?->toDateString(),
            ],
            'placed_at' => $order->placed_at->toIso8601String(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'fulfilled_at' => $order->fulfilled_at?->toIso8601String(),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $order->cancellation_reason?->value,
            'line_count' => count($presented),
            'lines' => $presented,
            'created_at' => $order->created_at?->toIso8601String(),
        ];
    }

    /**
     * The kitchen's book.
     *
     * `lock_version` is here because this is the audience that *writes*: the
     * confirm, fulfil and cancel actions all demand `If-Match`, and a screen
     * that could not read the validator could not send it.
     *
     * The delivery snapshot is served whole, including the street. It is
     * `Confidential` and it is also the address the food has to reach, so
     * withholding it from the kitchen would be privacy theatre performed on the
     * one party that needs the data to do the job.
     *
     * @param  iterable<int, OrderLine>  $lines
     * @return array{
     *     id: string,
     *     order_number: string,
     *     organisation_id: string,
     *     customer_account_id: string,
     *     sales_channel_id: string,
     *     branch_id: string|null,
     *     status: string,
     *     currency_code: string,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     payment_method: string,
     *     delivery: array{
     *         label: string|null,
     *         line_one: string,
     *         line_two: string|null,
     *         city: string|null,
     *         area_name_en: string|null,
     *         area_name_ar: string|null,
     *         area_id: string|null,
     *         zone_id: string|null,
     *         window_code: string|null,
     *         requested_date: string|null
     *     },
     *     placed_at: string,
     *     confirmed_at: string|null,
     *     fulfilled_at: string|null,
     *     cancelled_at: string|null,
     *     cancellation_reason: string|null,
     *     created_by: string|null,
     *     lock_version: int,
     *     line_count: int,
     *     lines: list<array{
     *         id: string,
     *         catalogue_item_id: string,
     *         catalogue_item_variant_id: string|null,
     *         name_en: string,
     *         name_ar: string,
     *         variant_label: string|null,
     *         quantity: string,
     *         unit_price_minor: int,
     *         line_total_minor: int,
     *         currency_code: string,
     *         allergens: list<array{allergen_code: string, containment: string}>,
     *         pack_summary: array<string, mixed>|null,
     *         price_list_id: string|null,
     *         price_list_item_id: string|null
     *     }>,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function kitchen(Order $order, iterable $lines): array
    {
        $presented = [];

        foreach ($lines as $line) {
            $presented[] = $this->kitchenLine($line);
        }

        return [
            'id' => (string) $order->getKey(),
            'order_number' => $order->order_number,
            'organisation_id' => $order->organisation_id,
            'customer_account_id' => $order->customer_account_id,
            'sales_channel_id' => $order->sales_channel_id,
            'branch_id' => $order->branch_id,
            'status' => $order->status->value,
            'currency_code' => $order->currency_code,
            'subtotal_minor' => $order->subtotal_minor,
            'delivery_fee_minor' => $order->delivery_fee_minor,
            'total_minor' => $order->total_minor,
            'payment_method' => $order->payment_method->value,
            'delivery' => [
                'label' => $order->delivery_label,
                'line_one' => $order->delivery_line_one,
                'line_two' => $order->delivery_line_two,
                'city' => $order->delivery_city,
                'area_name_en' => $order->delivery_area_name_en,
                'area_name_ar' => $order->delivery_area_name_ar,
                'area_id' => $order->delivery_area_id,
                'zone_id' => $order->delivery_zone_id,
                'window_code' => $order->delivery_window_code,
                'requested_date' => $order->requested_delivery_date?->toDateString(),
            ],
            'placed_at' => $order->placed_at->toIso8601String(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'fulfilled_at' => $order->fulfilled_at?->toIso8601String(),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $order->cancellation_reason?->value,
            'created_by' => $order->created_by,
            'lock_version' => $order->lock_version,
            'line_count' => count($presented),
            'lines' => $presented,
            'created_at' => $order->created_at?->toIso8601String(),
            'updated_at' => $order->updated_at?->toIso8601String(),
        ];
    }

    /**
     * One statement that money arrived.
     *
     * `method` is the receipt's own, which is **how the money turned up** and
     * deliberately not the order's `payment_method`, which is what was intended
     * at placement. An order taken for cash at the counter and settled by WISH
     * is a real evening; serving one of the two figures under the other's name
     * would make it unreadable.
     *
     * `confirmed_by` is served — the whole control on a WISH receipt is that a
     * named person asserted it, and a receipt whose asserter the reader cannot
     * see is an anonymous claim. It names a member of the kitchen's own staff to
     * the kitchen's own staff, which is the audience `OrderPresenter::kitchen()`
     * already shows `created_by` to.
     *
     * No `organisation_id`: a receipt is reachable only through an order that
     * `OrderQuery::forSeller()` has already scoped, so the field would restate
     * the caller's own organisation to itself.
     *
     * @return array{
     *     id: string,
     *     order_id: string,
     *     method: string,
     *     amount_minor: int,
     *     currency_code: string,
     *     reference: string|null,
     *     confirmed_by: string,
     *     confirmed_at: string,
     *     notes: string|null,
     *     created_at: string|null
     * }
     */
    public function paymentReceipt(OrderPaymentReceipt $receipt): array
    {
        return [
            'id' => (string) $receipt->getKey(),
            'order_id' => $receipt->order_id,
            'method' => $receipt->method->value,
            'amount_minor' => $receipt->amount_minor,
            'currency_code' => $receipt->currency_code,
            'reference' => $receipt->reference,
            'confirmed_by' => $receipt->confirmed_by,
            'confirmed_at' => $receipt->confirmed_at->toIso8601String(),
            'notes' => $receipt->notes,
            'created_at' => $receipt->created_at?->toIso8601String(),
        ];
    }

    /**
     * Where an order stands on being paid, in three fields.
     *
     * `$receivedMinor` is summed over the order's receipts by the caller and
     * handed in, never queried here: the desk queue derives it for a whole page
     * in one grouped statement, and a presenter that fetched its own would turn
     * two hundred rows into two hundred round trips.
     *
     * **`method` is the order's *intended* method**, not any receipt's. A queue
     * row is read before the money arrives — it is how the desk knows what to
     * ask the customer for — so the useful fact there is what the order was
     * taken on. What actually arrived is on the receipts, and the pair is only
     * legible while each one is served under its own name.
     *
     * **`receipted` rather than `paid`.** The word is doing real work: this
     * platform holds no proof that money exists, only that somebody at a desk
     * wrote down that it arrived. `>=` and not `==` because over-payment is
     * ordinary — a customer hands over a round note and takes change from the
     * till, which is not a row in this table — and a part payment leaves it
     * false until the balance lands.
     *
     * @return array{method: string, received_minor: int, receipted: bool}
     */
    public function paymentSummary(Order $order, int $receivedMinor): array
    {
        return [
            'method' => $order->payment_method->value,
            'received_minor' => $receivedMinor,
            'receipted' => $receivedMinor >= $order->total_minor,
        ];
    }

    /**
     * `quantity` is the decimal **string** the column holds, never coerced to a
     * number: it is the figure the line total was computed from, and a receipt
     * that rendered 0.35 kg as 0.34999999 would not reconcile against the
     * amount beside it.
     *
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     name_en: string,
     *     name_ar: string,
     *     variant_label: string|null,
     *     quantity: string,
     *     unit_price_minor: int,
     *     line_total_minor: int,
     *     currency_code: string,
     *     allergens: list<array{allergen_code: string, containment: string}>,
     *     pack_summary: array<string, mixed>|null
     * }
     */
    private function customerLine(OrderLine $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_id' => $line->catalogue_item_id,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'name_en' => $line->name_en,
            'name_ar' => $line->name_ar,
            'variant_label' => $line->variant_label,
            'quantity' => (string) $line->quantity,
            'unit_price_minor' => $line->unit_price_minor,
            'line_total_minor' => $line->line_total_minor,
            'currency_code' => $line->currency_code,
            'allergens' => $line->allergens,
            'pack_summary' => $line->pack_summary,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     name_en: string,
     *     name_ar: string,
     *     variant_label: string|null,
     *     quantity: string,
     *     unit_price_minor: int,
     *     line_total_minor: int,
     *     currency_code: string,
     *     allergens: list<array{allergen_code: string, containment: string}>,
     *     pack_summary: array<string, mixed>|null,
     *     price_list_id: string|null,
     *     price_list_item_id: string|null
     * }
     */
    private function kitchenLine(OrderLine $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_id' => $line->catalogue_item_id,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'name_en' => $line->name_en,
            'name_ar' => $line->name_ar,
            'variant_label' => $line->variant_label,
            'quantity' => (string) $line->quantity,
            'unit_price_minor' => $line->unit_price_minor,
            'line_total_minor' => $line->line_total_minor,
            'currency_code' => $line->currency_code,
            'allergens' => $line->allergens,
            'pack_summary' => $line->pack_summary,
            'price_list_id' => $line->price_list_id,
            'price_list_item_id' => $line->price_list_item_id,
        ];
    }
}
