<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Presenters;

use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Presenters\OrderPresenter;

/**
 * The wire shape of one row on the order desk queue.
 *
 * ## Why this one *is* built on `OrderPresenter::kitchen()`
 *
 * `OrderPresenter` states the platform's rule about projections and states it
 * strongly: `customer()` and `kitchen()` are constructed independently, because
 * a narrow shape produced by unsetting keys from a wide one is one careless
 * refactor away from leaking. That rule is about **subtraction**, and this row
 * does not subtract. It is the kitchen shape plus fields, served to the same
 * audience, behind the same `order.view_organisation` the kitchen shape is
 * behind — so composing is not the hazard the rule warns about, it is the
 * defence against a *different* one. Rebuilding the twenty-odd kitchen fields
 * here would mean two hand-maintained copies of the seller's projection, and
 * the day somebody adds a column to one the desk would quietly serve a row the
 * order book does not.
 *
 * The disclosure below is the part that is genuinely new, and it is the part
 * that is gated.
 *
 * ## The desk row carries a name and a telephone number. Nothing else does.
 *
 * Every other kitchen-facing projection on this platform withholds the pair,
 * and each does so with a reason worth repeating.
 * `SubscriptionPresenter::schedule()` carries no customer name and no address
 * because a production planner counts portions per window per day and every one
 * of those fields would be personal data on a screen that does not need it.
 * `KitchenOrderIndexController` will not even *search* on a name, because a
 * staff-facing search across confidential columns is how a directory of
 * everybody a kitchen has ever delivered to gets built one query at a time. The
 * order book's own row (`OrderPresenter::kitchen()`) carries the delivery
 * address — the food has to reach it — and still carries no name and no number.
 *
 * The desk is the one surface where those two facts have a job to do, and the
 * job is a telephone call. An order is late, or its window has slipped, or the
 * courier cannot find the building: somebody at the desk rings the customer.
 * A queue that showed the work but not who to ring would send that person to
 * another screen to look the customer up — which is a worse disclosure, because
 * it is a customer lookup with no order to justify it, and it would happen
 * dozens of times a shift.
 *
 * **What gates it.** `order.view_customer_contact_organisation`, checked by the
 * controller and passed in as `$includeContact`. This class never asks who is
 * calling. A presenter that read the Gate would be a presenter that could be
 * reused somewhere the Gate answers a different question — a job, a report, an
 * export — and be right by accident rather than by construction. Absent the
 * permission the `customer` key is **not present at all** rather than present
 * and null: null is a fact about the customer ("we hold no number"), and a
 * screen cannot tell that apart from a fact about the reader ("you may not see
 * it") unless the shapes differ.
 *
 * **What is deliberately not here.** No address beyond the delivery snapshot
 * the order book already serves, no email, no allergen declaration, no account
 * identifier the desk could pivot on, and no order history. A name and a number
 * is the least somebody can be called back on, and the permission is named for
 * exactly that much.
 *
 * ## `payment` and `delivery_job`
 *
 * Both were declared as typed nullable seats before either had anything to put
 * in them, so that the wire contract for a desk row would not change shape when
 * they arrived. `payment` has now arrived and is **never null**: every order has
 * a payment position, and "nothing has been paid" is `received_minor: 0` with
 * `receipted: false` rather than an absent object. Null would have been a third
 * state meaning nothing a desk could act on — an order whose payment position is
 * unknown is not a state this platform can reach, because the position is
 * derived from a sum that is zero when there is nothing to sum.
 *
 * The sum itself is **not computed here**. It arrives as `$receivedMinor`,
 * derived for the whole page in one grouped aggregate by `OrderDeskQueue::
 * receivedByOrder()`, for the reason `due_at` is handed in rather than
 * recomputed: a presenter that went to the database per row would turn two
 * hundred rows into two hundred round trips.
 *
 * `delivery_job` has now arrived too, and unlike `payment` it **is** nullable —
 * because "there is no run" is a fact about an order rather than a gap in the
 * server's knowledge, and it is true of three different orders for three good
 * reasons. A pickup or a counter sale is never driven anywhere. A delivery order
 * still `placed` has no job yet, because `OrderLifecycle::confirm()` is what
 * projects one and a placed order may still be cancelled without a driver ever
 * hearing about it. And a delivery order confirmed before C3 shipped was never
 * projected at all. All three read as `null`, which is the honest answer to
 * "which run is this" in every one of them; a desk that needs to distinguish
 * them has `fulfilment_type` and `status` on the same row.
 *
 * It arrives the same way the payment sum does — resolved for the whole page by
 * `OrderDeskQueue::deliveryJobsByOrder()` — and it carries the job's
 * `lock_version` so the Assign dialog has its `If-Match` without a second read.
 *
 * ## The `@return` shape is a restatement, and it moves when `kitchen()` moves
 *
 * Everything above the queue's own four keys is `OrderPresenter::kitchen()`'s,
 * copied into the docblock below because PHP has no way to say "that shape,
 * plus these". No code here has ever had to change when the order book gained a
 * column — `row()` composes and only adds — but the *documentation* of the
 * shape has to be brought along or the file starts describing a response the
 * server does not send. The fulfilment migration is the first time that
 * happened: `fulfilment_type`, `placed_on_behalf_by`, the five widened address
 * fields and two columns becoming nullable all arrived here through
 * composition, and the shape below was updated to say so.
 */
final class OrderDeskPresenter
{
    public function __construct(private readonly OrderPresenter $orders) {}

    /**
     * One queue row.
     *
     * `due_at` is computed in SQL and handed in rather than derived here, and
     * that is the point of it: it is the value the list was **sorted** by, so a
     * presenter that recomputed it could disagree with the ordering it is
     * decorating. It is an instant, never null — the expression behind it falls
     * through the delivery window's hours to the end of the requested day, and
     * through a missing requested day to `placed_at`.
     *
     * `$receivedMinor` is the sum of this order's receipts, zero when it has
     * none, and `$deliveryJob` is the run it became, null when there is none.
     * Both come from the same place and for the same reason: the queue derived
     * them for the whole page in one statement each.
     *
     * @param  iterable<int, OrderLine>  $lines
     * @param  array{id: string, status: string, tracking_status: string, driver_user_id: string|null, assigned_at: string|null, lock_version: int}|null  $deliveryJob
     * @param  array{display_name: string|null, phone: string|null}|null  $contact
     * @return array{
     *     id: string,
     *     order_number: string,
     *     organisation_id: string,
     *     customer_account_id: string|null,
     *     sales_channel_id: string,
     *     branch_id: string|null,
     *     status: string,
     *     currency_code: string,
     *     subtotal_minor: int,
     *     delivery_fee_minor: int|null,
     *     total_minor: int,
     *     payment_method: string,
     *     fulfilment_type: string,
     *     delivery: array{
     *         label: string|null,
     *         line_one: string|null,
     *         line_two: string|null,
     *         city: string|null,
     *         area_name_en: string|null,
     *         area_name_ar: string|null,
     *         area_id: string|null,
     *         zone_id: string|null,
     *         building: string|null,
     *         floor: string|null,
     *         apartment: string|null,
     *         directions: string|null,
     *         contact_point_id: string|null,
     *         window_code: string|null,
     *         requested_date: string|null
     *     },
     *     placed_at: string,
     *     confirmed_at: string|null,
     *     fulfilled_at: string|null,
     *     cancelled_at: string|null,
     *     cancellation_reason: string|null,
     *     created_by: string|null,
     *     placed_on_behalf_by: string|null,
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
     *     updated_at: string|null,
     *     due_at: string,
     *     payment: array{method: string, received_minor: int, receipted: bool},
     *     delivery_job: array{id: string, status: string, tracking_status: string, driver_user_id: string|null, assigned_at: string|null, lock_version: int}|null,
     *     customer?: array{display_name: string|null, phone: string|null}
     * }
     */
    public function row(
        Order $order,
        iterable $lines,
        string $dueAt,
        int $receivedMinor,
        ?array $deliveryJob,
        bool $includeContact,
        ?array $contact = null,
    ): array {
        $row = $this->orders->kitchen($order, $lines);

        $row['due_at'] = $dueAt;

        // The order's *intended* method beside what has actually arrived — the
        // pair a desk reads together, which is why the summary is one object
        // rather than two fields on the row. Built by `OrderPresenter` because
        // the receipt endpoint serves the identical shape, and two copies of
        // "receipted" would eventually disagree.
        $row['payment'] = $this->orders->paymentSummary($order, $receivedMinor);

        // The seat C3 declared, now filled. Null is a real answer here — no
        // pickup, no counter sale and no unconfirmed delivery has a run — and
        // the key is present either way, which is what the seat was declared
        // early to guarantee.
        $row['delivery_job'] = $deliveryJob;

        if ($includeContact) {
            // Null-safe throughout, and every level of it is reachable. The
            // order may name an account that has been anonymised (J2 redacts
            // `display_name`), an account whose owner never gave a number, or —
            // in production, where this query runs under a row-level-security
            // policy that scopes `customer_accounts` to their own user or their
            // own organisation — no readable account row at all. A desk row
            // that fell over on any of those would take the whole queue with
            // it.
            $row['customer'] = [
                'display_name' => $contact['display_name'] ?? null,
                'phone' => $contact['phone'] ?? null,
            ];
        }

        return $row;
    }
}
