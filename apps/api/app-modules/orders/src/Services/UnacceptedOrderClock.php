<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Services\OrganisationTimezone;

/**
 * How long each `placed` order has waited while a kitchen could have accepted
 * it. The wall board and the escalation job both read this, so the red ticket
 * and the manager's SMS run on one clock.
 *
 * Counted from `placed_at`, on the branches {@see ServingBranches} says could
 * make the order. Each order's `deliveryZone` should be eager-loaded.
 *
 * **An order for a later day is not waiting yet.** It has no answer here until
 * its own day comes, and its clock then starts at the start of that day, or a
 * week-old order would alarm the moment the kitchen opened. Today is read on the
 * one branch that can make the order, or on the organisation's clock when there
 * is more than one or none. An order that names no day is as soon as possible and
 * always counts.
 */
final readonly class UnacceptedOrderClock
{
    public function __construct(
        private ServingBranches $branches,
        private OrderSchedulingLookup $schedule,
        private OrganisationTimezone $timezones,
    ) {}

    /**
     * @param  iterable<int, Order>  $orders  any status; only the placed ones are answered
     * @return array<string, int> open minutes keyed by order id; an order for a later day has no entry
     */
    public function openMinutes(string $organisationId, iterable $orders, CarbonImmutable $at): array
    {
        $placed = [];

        foreach ($orders as $order) {
            if ($order->status === OrderStatus::Placed) {
                $placed[(string) $order->getKey()] = $order;
            }
        }

        $serving = $this->branches->forOrders($organisationId, $placed);
        $spans = [];
        $zones = [];

        foreach ($placed as $id => $order) {
            $from = $order->placed_at;
            $requested = $order->requested_delivery_date?->toDateString();

            if ($requested !== null) {
                $branchId = count($serving[$id]) === 1 ? $serving[$id][0] : null;
                $zone = $zones[$branchId ?? ''] ??= $branchId === null
                    ? $this->timezones->forOrganisationId($organisationId)
                    : $this->schedule->timezoneOf($branchId);

                if ($requested > $at->setTimezone($zone)->toDateString()) {
                    continue;
                }

                $from = $from->max(CarbonImmutable::parse($requested, $zone));
            }

            $spans[$id] = ['branch_ids' => $serving[$id], 'from' => $from];
        }

        return $this->schedule->openMinutesForEach($spans, $at);
    }
}
