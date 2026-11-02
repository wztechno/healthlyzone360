<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Contracts\DeliveredOrderHandover;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Validation\ValidationException;

/**
 * The driver's handover, as the order lifecycle's own fulfilment.
 *
 * Through `OrderLifecycle::fulfil()` rather than a column write, so the
 * transition rules and the audit entry are the ones the desk's Mark fulfilled
 * produces, with the driver as the actor.
 *
 * **The receipt is the driver's word for what they took.** `fulfil()` writes
 * nothing for a delivery, because a delivery fulfilled from the display has no
 * money in anybody's hand. So this is the one place delivery cash becomes a
 * receipt: the amount is what the driver said, against the driver, and what is
 * short stays outstanding for Unsettled. Zero needs a reason and a manager hears
 * about it. A WISH order asks nothing, because a transfer is only paid once
 * somebody has checked its reference.
 *
 * The order row is locked first, as `OrderPaymentReceiptStoreController` locks
 * it, so the amount outstanding cannot move between being read and being used.
 * A refusal here rolls back the job update in the caller's transaction, so a
 * refused amount leaves the run open.
 */
final class DeliveredOrderFulfilment implements DeliveredOrderHandover
{
    public function __construct(
        private readonly OrderLifecycle $lifecycle,
        private readonly OrderPaymentReceipts $receipts,
        private readonly StaffAlerts $alerts,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function delivered(string $orderId, string $driverUserId, ?int $collectedMinor, ?string $note): void
    {
        $order = Order::query()->whereKey($orderId)->lockForUpdate()->first();

        if (! $order instanceof Order || ! $order->status->canTransitionTo(OrderStatus::Fulfilled)) {
            return;
        }

        if ($order->payment_method === PaymentMethod::Wish) {
            $this->lifecycle->fulfil($order);

            return;
        }

        $outstanding = max(0, $order->total_minor - (int) $order->paymentReceipts()->sum('amount_minor'));
        $collected = $this->refuseAmount($collectedMinor, $outstanding, $note);

        $this->lifecycle->fulfil($order);

        if ($collected > 0) {
            $this->receipts->audit($this->receipts->write($order, $order->payment_method, $collected, $driverUserId));
        } elseif ($outstanding > 0) {
            $this->noCashCollected($order, $driverUserId, $outstanding);
        }
    }

    /**
     * What the driver said they took, once it is something that can be true.
     *
     * @throws ValidationException
     */
    private function refuseAmount(?int $collectedMinor, int $outstanding, ?string $note): int
    {
        if ($collectedMinor === null) {
            throw ValidationException::withMessages(['collected_minor' => 'Say how much cash you collected.']);
        }

        if ($collectedMinor > $outstanding) {
            throw ValidationException::withMessages(['collected_minor' => 'That is more than this order still owes.']);
        }

        if ($collectedMinor === 0 && $outstanding > 0 && ($note === null || trim($note) === '')) {
            throw ValidationException::withMessages(['note' => 'Say why no cash was collected.']);
        }

        return $collectedMinor;
    }

    private function noCashCollected(Order $order, string $driverUserId, int $outstanding): void
    {
        $this->audit->record(
            'order.no_cash_collected',
            actorUserId: $driverUserId,
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: ['outstanding_minor' => $outstanding, 'currency' => $order->currency_code],
        );

        $this->alerts->send(StaffAlertType::NoCashCollected, $order->organisation_id, (string) $order->getKey(), [
            'order_number' => $order->order_number,
            'total_minor' => $order->total_minor,
            'currency_code' => $order->currency_code,
        ]);
    }
}
