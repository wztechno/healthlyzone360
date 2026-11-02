<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Enums\DeliveryFailureReason;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Services\ZoneWindowService;
use Healthy360\Orders\Contracts\DeliveryJobProjection;
use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Every way a run ends other than at the door, and the courier that may carry it.
 *
 * **A failure is the run's, and the order waits.** The order stays `confirmed` and
 * no money moves. A manager then either sends it out again, which returns the run
 * to `pending` so a driver can take it, or closes it, which cancels the order with
 * `delivery_failed` through the ordinary lifecycle.
 *
 * **Re-delivering asks the desk's questions.** A new day or window runs
 * `OrderTimingRules` as a desk sale does, lead time excepted, plus whether the
 * zone offers the window. It takes the order's `If-Match` and always moves the
 * version, so closing and re-delivering the same failure cannot both win.
 *
 * Closing asks nothing about who may: the route's permission is the answer, and a
 * failed delivery's food has already been cooked.
 */
final readonly class FailedDelivery
{
    public function __construct(
        private DeliveryJobProjection $jobs,
        private OrderLifecycle $lifecycle,
        private OrderDeliveryRuns $runs,
        private OrderTimingRules $timing,
        private ZoneWindowService $zoneWindows,
        private StaffAlerts $alerts,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @throws ApiException when the run is not on the road
     */
    public function fail(Order $order, DeliveryFailureReason $reason, ?string $note): void
    {
        $this->jobs->fail($order, $reason, $note);

        $this->audit->record(
            'delivery.job_failed',
            actorUserId: $this->context->userId(),
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: ['failure_reason' => $reason->value],
        );

        $this->alerts->send(StaffAlertType::DeliveryFailed, $order->organisation_id, (string) $order->getKey(), [
            'order_number' => $order->order_number,
            'total_minor' => $order->total_minor,
            'currency_code' => $order->currency_code,
        ]);
    }

    /**
     * @throws ApiException when the run has not failed, or the version is stale
     * @throws PlacementRefused when the new day or window is one the desk could not sell
     */
    public function redeliver(Order $order, ?CarbonImmutable $date, ?string $window, int $expectedLockVersion): Order
    {
        if ($date instanceof CarbonImmutable || $window !== null) {
            $this->refuseSchedule($order, $date ?? $order->requested_delivery_date, $window ?? $order->delivery_window_code);
        }

        DB::transaction(function () use ($order, $date, $window, $expectedLockVersion): void {
            $updated = Order::query()
                ->whereKey($order->getKey())
                ->where('status', OrderStatus::Confirmed->value)
                ->where('lock_version', $expectedLockVersion)
                ->update(array_filter([
                    'requested_delivery_date' => $date?->toDateString(),
                    'delivery_window_code' => $window,
                ], static fn (?string $value): bool => $value !== null) + [
                    'lock_version' => DB::raw('lock_version + 1'),
                    'updated_at' => CarbonImmutable::now(),
                ]);

            if ($updated === 0) {
                throw new ApiException(
                    ErrorCode::ResourceConflict,
                    'This order changed while you were working on it. Reload it and try again.',
                );
            }

            $this->jobs->reopen($order);
        });

        $order->refresh();

        $this->audit->record(
            'delivery.job_reopened',
            actorUserId: $this->context->userId(),
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: array_filter([
                'requested_date' => $order->requested_delivery_date?->toDateString(),
                'delivery_window' => $order->delivery_window_code,
                'lock_version' => $order->lock_version,
            ], static fn (mixed $value): bool => $value !== null),
        );

        return $order;
    }

    /**
     * @throws ApiException when the run has not failed, or the version is stale
     */
    public function closeFailed(Order $order, CancellationDisposition $disposition, int $expectedLockVersion): Order
    {
        if (($this->runs->forOrder((string) $order->getKey())['status'] ?? null) !== 'failed') {
            throw new ApiException(ErrorCode::ResourceConflict, 'Only a failed delivery can be closed as failed.');
        }

        return $this->lifecycle->cancel($order, CancellationReason::DeliveryFailed, $expectedLockVersion, $disposition);
    }

    /**
     * @throws ApiException when the food is not ready, or the run has left already
     */
    public function handToCourier(Order $order, string $name, ?string $reference, ?int $feeMinor): void
    {
        // The driver's own rule (HA-28): nobody collects food that is not cooked.
        if ($order->ready_at === null) {
            throw new ApiException(ErrorCode::ResourceConflict, 'The kitchen has not marked this order ready yet.');
        }

        $this->jobs->handToCourier($order, $name, $reference, $feeMinor);

        $this->audit->record(
            'delivery.job_handed_to_courier',
            actorUserId: $this->context->userId(),
            subjectType: 'order',
            subjectId: (string) $order->getKey(),
            metadata: array_filter([
                'courier' => $name,
                'courier_reference' => $reference,
                'fee_minor' => $feeMinor,
            ], static fn (mixed $value): bool => $value !== null),
        );
    }

    /**
     * @throws PlacementRefused
     */
    private function refuseSchedule(Order $order, ?CarbonImmutable $date, ?string $window): void
    {
        $zone = $order->delivery_zone_id === null ? null : $order->deliveryZone;

        if ($zone instanceof DeliveryZone && $window !== null && ! in_array($window, $this->zoneWindows->offeredCodes($zone), true)) {
            throw new PlacementRefused([[
                'reason' => 'window_not_offered',
                'delivery_window_code' => $window,
                'delivery_zone_id' => (string) $zone->getKey(),
            ]]);
        }

        $refusals = $this->timing->refusals(
            $order->organisation_id,
            $order->branch_id,
            $zone,
            $date,
            $window,
            CarbonImmutable::now(),
            leadTime: false,
        );

        if ($refusals !== []) {
            throw new PlacementRefused($refusals);
        }
    }
}
