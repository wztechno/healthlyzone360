<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Kitchens\Models\BranchClosure;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * A standing delivery that lands on a closed day moves to the next day the
 * kitchen is open, and the managers hear about it (owner, 3 Nov 2026).
 *
 * "Standing" is a subscription day or an accepted quotation: both keep the day
 * that was agreed, so neither is refused for it and each used to go out on a
 * holiday. "Open" is {@see OrderTimingRules::nextOpenDay()}, weekly hours and
 * closures, the rule every order already meets.
 *
 * Asked at three moments: a subscription day being generated, a quotation being
 * accepted, and a closure added over orders already placed. A day with nothing
 * open for {@see SEARCH_DAYS} more keeps its date and alerts anyway.
 */
final readonly class ClosedDayDeliveries
{
    /** How far past a closed day the next open one is looked for. */
    public const int SEARCH_DAYS = 14;

    /** The price sources only a subscription day or an accepted quotation writes. */
    private const array STANDING_SOURCES = [PriceOverride::SUBSCRIPTION_CAPTURE, PriceOverride::SUBSCRIPTION_INCLUDED, PriceOverride::QUOTATION];

    public function __construct(
        private OrderTimingRules $timing,
        private StaffAlerts $alerts,
        private AuditRecorder $audit,
    ) {}

    /**
     * The day a standing delivery for `$date` goes out: `$date` when the kitchen is
     * open, the next open day when not, null when none opens in time.
     */
    public function dayFor(string $organisationId, ?string $branchId, ?DeliveryZone $zone, CarbonImmutable $date): ?CarbonImmutable
    {
        return $this->timing->nextOpenDay($organisationId, $branchId, $zone, $date, CarbonImmutable::now(), self::SEARCH_DAYS);
    }

    /**
     * Tell the managers an order was moved off a closed day.
     */
    public function alertMoved(Order $order): void
    {
        $this->alerts->send(StaffAlertType::DeliveryMovedClosed, $order->organisation_id, (string) $order->getKey(), [
            'order_number' => $order->order_number,
        ]);
    }

    /**
     * Tell the managers a delivery stays on a closed day: no open day was found.
     * The subject is the order, or what stands for it when none was placed.
     */
    public function alertUnmoved(string $organisationId, string $subjectId, CarbonImmutable $date): void
    {
        $this->alerts->send(StaffAlertType::DeliveryClosedUnmoved, $organisationId, $subjectId, [
            'order_number' => $date->toDateString(),
        ]);
    }

    /**
     * A closure added over standing orders already placed: each one the kitchen has
     * not started moves on, as generation would have moved it. Orders naming
     * another branch are not this closure's; one naming none may still be served
     * by another branch, which {@see dayFor()} answers.
     *
     * Never refuses the closure: it is saved before this runs, and a failure here
     * is reported and leaves the orders where they were.
     *
     * @return int how many orders moved
     */
    public function closureAdded(BranchClosure $closure): int
    {
        try {
            return DB::transaction(function () use ($closure): int {
                $orders = Order::withoutTenancy()
                    ->with('deliveryZone')
                    ->where('organisation_id', $closure->organisation_id)
                    ->whereIn('status', [OrderStatus::Placed->value, OrderStatus::Confirmed->value])
                    ->whereNull('preparing_at')
                    ->whereNull('ready_at')
                    ->whereBetween('requested_delivery_date', [$closure->closed_from->toDateString(), $closure->closed_to->toDateString()])
                    ->where(fn ($branch) => $branch->whereNull('branch_id')->orWhere('branch_id', $closure->branch_id))
                    ->whereExists(fn ($lines) => $lines->from('order_lines')
                        ->whereColumn('order_lines.order_id', 'orders.id')
                        ->whereIn('order_lines.price_source', self::STANDING_SOURCES))
                    ->lockForUpdate()
                    ->get();

                $moved = 0;

                foreach ($orders as $order) {
                    /** @var CarbonImmutable $date */
                    $date = $order->requested_delivery_date;
                    $day = $this->dayFor($order->organisation_id, $order->branch_id, $order->deliveryZone, $date);

                    if ($day === null) {
                        $this->alertUnmoved($order->organisation_id, (string) $order->getKey(), $date);

                        continue;
                    }

                    if ($day->equalTo($date)) {
                        continue;
                    }

                    $order->requested_delivery_date = $day;
                    // An edit opened before the move must not put the old day back.
                    $order->lock_version++;
                    $order->save();

                    $this->audit->record(
                        'order.moved_off_closure',
                        subjectType: 'order',
                        subjectId: (string) $order->getKey(),
                        metadata: ['from' => $date->toDateString(), 'to' => $day->toDateString(), 'branch_closure_id' => (string) $closure->getKey()],
                    );

                    // The buyer's run of a repeating quotation names each date too.
                    DB::table('quotation_orders')->where('order_id', $order->getKey())->update(['delivery_date' => $day->toDateString()]);

                    $this->alertMoved($order);
                    $moved++;
                }

                return $moved;
            });
        } catch (Throwable $e) {
            report($e);

            return 0;
        }
    }
}
