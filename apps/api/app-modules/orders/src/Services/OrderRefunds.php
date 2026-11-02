<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Enums\OrderRefundKind;
use Healthy360\Orders\Enums\OrderRefundStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderRefund;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Taking money back off an order, on a ledger beside the receipts.
 *
 * **The cap is what the receipts say arrived, less everything already taken
 * back or waiting to be.** Read and written under a lock on the order, the row
 * `OrderPaymentReceiptStoreController` locks too, for the reason
 * `PaymentService::refund()` locks its intent: two refunds racing a
 * check-then-act would both find room and jointly exceed it. A pending entry
 * counts, so the owner can never approve one into a cap a later one has spent.
 *
 * **The limit is cumulative per order**, so three refunds of $40 cannot walk past
 * a $50 limit one at a time.
 *
 * **Seven days run from the order's latest receipt**, not its first: a deposit
 * taken a week before delivery must not close the window on the food arriving.
 * The window applies when an entry is asked for, not when the owner answers.
 *
 * Each entry is audited on the order, so its trail stays one query.
 */
final readonly class OrderRefunds
{
    private const int WINDOW_DAYS = 7;

    public function __construct(
        private KitchenServiceSettingsLookup $settings,
        private StaffAlerts $alerts,
        private AuditRecorder $audit,
    ) {}

    /**
     * Where this order stands. Received is the receipts as written; an entry
     * never edits one.
     *
     * @return array{received_minor: int, refunded_minor: int, corrected_minor: int, pending_minor: int, refundable_minor: int, window_closes_at: CarbonImmutable|null}
     */
    public function position(Order $order): array
    {
        $received = (int) $order->paymentReceipts()->sum('amount_minor');
        $latest = $order->paymentReceipts()->max('confirmed_at');

        $entries = OrderRefund::query()->where('order_id', $order->getKey())
            ->where('status', '!=', OrderRefundStatus::Rejected->value)
            ->get(['kind', 'status', 'amount_minor']);

        $pending = (int) $entries->where('status', OrderRefundStatus::PendingApproval)->sum('amount_minor');
        $completed = $entries->where('status', OrderRefundStatus::Completed);
        $refunded = (int) $completed->where('kind', OrderRefundKind::Refund)->sum('amount_minor');
        $corrected = (int) $completed->where('kind', OrderRefundKind::ReceiptCorrection)->sum('amount_minor');

        return [
            'received_minor' => $received,
            'refunded_minor' => $refunded,
            'corrected_minor' => $corrected,
            'pending_minor' => $pending,
            'refundable_minor' => max(0, $received - $refunded - $corrected - $pending),
            'window_closes_at' => is_string($latest) ? CarbonImmutable::parse($latest)->addDays(self::WINDOW_DAYS) : null,
        ];
    }

    /**
     * Write one entry. It completes at once when the order stays within the
     * kitchen's limit or the person asking may approve it themselves; otherwise it
     * waits for the owner, who is alerted.
     *
     * @throws ApiException
     */
    public function record(
        Order $order,
        OrderRefundKind $kind,
        PaymentMethod $method,
        int $amountMinor,
        string $reason,
        string $actorUserId,
        bool $actorMayApprove,
    ): OrderRefund {
        return DB::transaction(function () use ($order, $kind, $method, $amountMinor, $reason, $actorUserId, $actorMayApprove): OrderRefund {
            $locked = $this->lock($order);
            $position = $this->position($locked);

            if ($position['window_closes_at']?->isPast() === true) {
                throw new ApiException(ErrorCode::ResourceConflict, 'This order was last paid more than '.self::WINDOW_DAYS.' days ago, so it can no longer be refunded.', [
                    'window_closes_at' => $position['window_closes_at']->toIso8601String(),
                ]);
            }

            $taken = $position['received_minor'] - $position['refundable_minor'];

            if ($amountMinor > $position['refundable_minor']) {
                throw new ApiException(ErrorCode::PaymentRefundExceedsCapture, details: [
                    'captured_minor' => $position['received_minor'],
                    'refunded_minor' => $taken,
                    'refundable_minor' => $position['refundable_minor'],
                ]);
            }

            $limit = $this->settings->for($locked->organisation_id)->refund_approval_above_minor;
            $waits = $taken + $amountMinor > $limit && ! $actorMayApprove;
            $now = CarbonImmutable::now();

            $entry = new OrderRefund;
            $entry->organisation_id = $locked->organisation_id;
            $entry->order_id = (string) $locked->getKey();
            $entry->kind = $kind;
            $entry->status = $waits ? OrderRefundStatus::PendingApproval : OrderRefundStatus::Completed;
            $entry->method = $method;
            $entry->amount_minor = $amountMinor;
            $entry->currency_code = $locked->currency_code;
            $entry->reason = $reason;
            $entry->requested_by = $actorUserId;
            $entry->requested_at = $now;
            $entry->decided_by = $waits ? null : $actorUserId;
            $entry->decided_at = $waits ? null : $now;
            $entry->save();

            $this->auditEntry($waits ? 'order.refund_requested' : 'order.refund_completed', $entry, $actorUserId);

            if ($waits) {
                $this->alerts->send(StaffAlertType::RefundApproval, $locked->organisation_id, (string) $locked->getKey(), [
                    'order_number' => $locked->order_number,
                    'total_minor' => $amountMinor,
                    'currency_code' => $locked->currency_code,
                ]);
            }

            return $entry;
        });
    }

    /**
     * The owner's answer to an entry that waited. Pending money stayed inside the
     * cap, so approving needs no second check of it.
     *
     * @throws ApiException
     */
    public function decide(Order $order, string $refundId, bool $approved, string $actorUserId): OrderRefund
    {
        return DB::transaction(function () use ($order, $refundId, $approved, $actorUserId): OrderRefund {
            $this->lock($order);

            $entry = OrderRefund::query()->where('order_id', $order->getKey())->whereKey($refundId)->first();

            if (! $entry instanceof OrderRefund) {
                throw new ApiException(ErrorCode::ResourceNotFound);
            }

            if ($entry->status !== OrderRefundStatus::PendingApproval) {
                throw new ApiException(ErrorCode::ResourceConflict, 'This refund has already been decided.', ['status' => $entry->status->value]);
            }

            $entry->status = $approved ? OrderRefundStatus::Completed : OrderRefundStatus::Rejected;
            $entry->decided_by = $actorUserId;
            $entry->decided_at = CarbonImmutable::now();
            $entry->save();

            $this->auditEntry($approved ? 'order.refund_completed' : 'order.refund_rejected', $entry, $actorUserId);

            return $entry;
        });
    }

    /**
     * @throws ApiException
     */
    private function lock(Order $order): Order
    {
        $locked = Order::query()->whereKey($order->getKey())->lockForUpdate()->first();

        if (! $locked instanceof Order) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $locked;
    }

    /**
     * Metadata says `currency`, never `currency_code`: see
     * {@see OrderPaymentReceipts::audit()}. The reason stays on the row.
     */
    private function auditEntry(string $action, OrderRefund $entry, string $actorUserId): void
    {
        $this->audit->record(
            $action,
            actorUserId: $actorUserId,
            subjectType: 'order',
            subjectId: $entry->order_id,
            metadata: [
                'refund_id' => (string) $entry->getKey(),
                'kind' => $entry->kind->value,
                'method' => $entry->method->value,
                'amount_minor' => $entry->amount_minor,
                'currency' => $entry->currency_code,
            ],
        );
    }
}
