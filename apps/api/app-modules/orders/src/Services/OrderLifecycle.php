<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Closure;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Exceptions\TransitionRejected;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The only way an order changes state.
 *
 * `placed → confirmed → fulfilled`, with `cancelled` reachable from the first
 * two. The edges themselves live on `OrderStatus` so that nothing here can
 * invent a fifth one; this class is what makes each edge *happen* — the
 * timestamp, the audit event, the optimistic-concurrency check — in one
 * transaction.
 *
 * **Every transition stamps its own moment.** `confirmed_at`, `fulfilled_at`
 * and `cancelled_at` are separate columns rather than one `status_changed_at`,
 * because an operations question — how long between taking an order and
 * confirming it — is answerable from columns and unanswerable from a single
 * field that has been overwritten twice.
 *
 * **`lock_version` is checked when the caller offers one.** A kitchen screen
 * showing an order list is stale the moment it renders, and two staff members
 * confirming the same order at once is an ordinary Tuesday. Callers that have
 * a validator pass it; the state machine refuses anyway if the transition is
 * illegal, so the version check is protection against a *lost update*, not
 * against an impossible move.
 *
 * Audited as `order.confirmed`, `order.fulfilled` and `order.cancelled`.
 * Metadata carries the reason as `cancellation_reason` — spelled without a
 * `_code` suffix deliberately, because the audit redactor blanks any key
 * containing `code` and a redacted cancellation reason is an audit trail that
 * cannot say why an order was cancelled.
 */
final readonly class OrderLifecycle
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
        private OrderStockConsumption $consumption,
    ) {}

    /**
     * Confirming is the kitchen committing to cook, so it is also the moment
     * the ingredients come off the shelf (INV1.2). The deduction runs *inside*
     * the same transaction as the status change — a confirmed order whose stock
     * did not move, or moved stock on an order that failed to confirm, are both
     * states nobody could reconcile — and it is idempotent, so the lost-update
     * retry the `If-Match` guard already contemplates cannot double-deduct.
     *
     * @throws ApiException
     */
    public function confirm(Order $order, ?int $expectedLockVersion = null): Order
    {
        return $this->transition(
            $order,
            OrderStatus::Confirmed,
            $expectedLockVersion,
            ['confirmed_at' => CarbonImmutable::now()],
            function (Order $confirmed): void {
                $this->consumption->consume($confirmed);
            },
        );
    }

    /**
     * @throws ApiException
     */
    public function fulfil(Order $order, ?int $expectedLockVersion = null): Order
    {
        return $this->transition($order, OrderStatus::Fulfilled, $expectedLockVersion, ['fulfilled_at' => CarbonImmutable::now()]);
    }

    /**
     * A cancellation always carries a reason, because the fixed vocabulary is
     * only useful if it is never optional — an order cancelled "for no stated
     * reason" is the row that makes every count wrong.
     *
     * @throws ApiException
     */
    public function cancel(Order $order, CancellationReason $reason, ?int $expectedLockVersion = null): Order
    {
        return $this->transition(
            $order,
            OrderStatus::Cancelled,
            $expectedLockVersion,
            [
                'cancelled_at' => CarbonImmutable::now(),
                'cancellation_reason' => $reason,
            ],
            function (Order $cancelled): void {
                $this->consumption->restore($cancelled);
            },
        );
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @param  (Closure(Order): void)|null  $within  a side effect run inside the transition's own transaction, after the row has moved and been reloaded — where the stock deduction and its reversal belong, so they commit or roll back with the status change and never on their own
     *
     * @throws ApiException
     */
    private function transition(Order $order, OrderStatus $to, ?int $expectedLockVersion, array $attributes, ?Closure $within = null): Order
    {
        $from = $order->status;

        if (! $from->canTransitionTo($to)) {
            throw new TransitionRejected($from, $to);
        }

        DB::transaction(function () use ($order, $to, $expectedLockVersion, $attributes, $within): void {
            $query = Order::query()->whereKey($order->getKey())->where('status', $order->status->value);

            if ($expectedLockVersion !== null) {
                $query->where('lock_version', $expectedLockVersion);
            }

            $updated = $query->update([
                ...$attributes,
                'status' => $to->value,
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => CarbonImmutable::now(),
            ]);

            if ($updated === 0) {
                // Either somebody else moved it between the read and the
                // write, or the validator is stale. Both are the same answer
                // to the caller: reload and look again.
                throw new ApiException(
                    ErrorCode::ResourceConflict,
                    'This order changed while you were working on it. Reload it and try again.',
                );
            }

            $order->refresh();

            $within?->__invoke($order);
        });

        $this->audit->record(
            'order.'.$to->value,
            actorUserId: $this->context->userId(),
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: array_filter([
                'from_status' => $from->value,
                'to_status' => $to->value,
                'cancellation_reason' => $order->cancellation_reason?->value,
                'lock_version' => $order->lock_version,
            ], static fn (mixed $value): bool => $value !== null),
        );

        return $order;
    }
}
