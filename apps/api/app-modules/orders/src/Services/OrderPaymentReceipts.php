<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;

/**
 * Writing down that money arrived — the row, and the event that says who wrote
 * it.
 *
 * Extracted when the Order Desk grew a second caller. `OrderPaymentReceiptStore
 * Controller` had been the only place a receipt was written, and it was
 * therefore also the only place that knew the four decisions a receipt row
 * embodies: the currency comes from the **order** and never from the request,
 * `confirmed_at` is stamped by the **server** and never taken from the body,
 * the audit event is `order.payment_recorded` with the **order** as its subject,
 * and its metadata says `currency` rather than `currency_code` because
 * `AuditRecorder` redacts any key containing `code` and a redacted currency is a
 * takings figure nobody can add up.
 *
 * A second copy of those four would have been four chances to drift, and the
 * one that drifted would be whichever ran less often.
 *
 * ## Two methods, never one, and the split is the whole design
 *
 * `write()` inserts the row. `audit()` records the event. They are separate
 * because **the two callers disagree about which transaction the audit belongs
 * in**, and that disagreement is deliberate on both sides:
 *
 *  * The **endpoint** opens a transaction so the order can be re-read
 *    `FOR UPDATE` before the insert — the lock is what stops a cancellation
 *    racing the receipt — and then audits *outside* it, matching
 *    `OrderLifecycle`, whose audit is likewise written after its transition
 *    commits.
 *  * `CounterSale` audits *inside* its own, because the receipt it is writing is
 *    one step of a sale that either wholly happens or wholly does not. An
 *    `order.payment_recorded` row for a sale that rolled back would be a
 *    payment against an order that never existed.
 *
 * Fusing them into one call would have forced one of those two to be wrong, and
 * the wrong one would have been silent. Neither method opens a transaction of
 * its own: whose transaction this runs in is the caller's decision, and it is
 * the only decision about a receipt that is.
 *
 * **Nothing here refuses anything.** No cancelled-order check, no `If-Match`, no
 * amount validation. Those are the endpoint's, because they are about a *stale
 * screen* — a desk that was offering "take payment" for an order somebody
 * cancelled while it was rendering — and a caller holding an order it placed
 * itself thirty milliseconds ago has no screen to be stale. Putting them here
 * would make `CounterSale` pass a lock version it invented to a check it could
 * not fail.
 */
final readonly class OrderPaymentReceipts
{
    public function __construct(private AuditRecorder $audit) {}

    /**
     * Insert one statement that money arrived against this order.
     *
     * Runs in whatever transaction the caller has open, and opens none. The
     * currency is the order's — a receipt in another currency is not a receipt
     * for this order, it is a conversion nobody performed — and `confirmed_at`
     * is now, stamped here rather than accepted from anybody: a caller that
     * could name the moment could name a moment in another shift, and
     * `confirmed_at` is what a day's takings are cut on.
     *
     * @param  string  $confirmedBy  the `users` id of the person asserting it; the whole control on a WISH receipt
     */
    public function write(
        Order $order,
        PaymentMethod $method,
        int $amountMinor,
        string $confirmedBy,
        ?string $reference = null,
        ?string $notes = null,
    ): OrderPaymentReceipt {
        $receipt = new OrderPaymentReceipt;
        $receipt->organisation_id = $order->organisation_id;
        $receipt->order_id = (string) $order->getKey();
        $receipt->method = $method;
        $receipt->amount_minor = $amountMinor;
        $receipt->currency_code = $order->currency_code;
        $receipt->reference = $reference;
        $receipt->confirmed_by = $confirmedBy;
        $receipt->confirmed_at = CarbonImmutable::now();
        $receipt->notes = $notes;
        $receipt->save();

        return $receipt;
    }

    /**
     * Record `order.payment_recorded` for a receipt that has been written.
     *
     * The subject is the **order**, not the receipt, so that an order's whole
     * trail — placed, confirmed, paid, fulfilled — is one query rather than two
     * joined on a metadata field.
     *
     * The actor is the receipt's own `confirmed_by` rather than the ambient
     * `TenantContext` user. On both paths those are the same person today; using
     * the receipt's makes the audit row and the row it is about impossible to
     * disagree, which is the property that matters when somebody is reading a
     * shift's takings back.
     */
    public function audit(OrderPaymentReceipt $receipt): void
    {
        $this->audit->record(
            'order.payment_recorded',
            actorUserId: $receipt->confirmed_by,
            subjectType: 'order',
            subjectId: $receipt->order_id,
            metadata: [
                'receipt_id' => (string) $receipt->getKey(),
                'method' => $receipt->method->value,
                'amount_minor' => $receipt->amount_minor,
                // Never `currency_code`: the audit redactor blanks any key
                // containing `code`, and a redacted currency is a takings figure
                // nobody can add up.
                'currency' => $receipt->currency_code,
            ],
        );
    }
}
