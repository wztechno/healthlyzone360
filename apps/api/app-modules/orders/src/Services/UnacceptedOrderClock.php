<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;

/**
 * How long each `placed` order has waited while a kitchen could have accepted
 * it. The wall board and the escalation job both read this, so the red ticket
 * and the manager's SMS run on one clock.
 *
 * Counted from `placed_at`, on the branches {@see ServingBranches} says could
 * make the order. Each order's `deliveryZone` should be eager-loaded.
 */
final readonly class UnacceptedOrderClock
{
    public function __construct(
        private ServingBranches $branches,
        private OrderSchedulingLookup $schedule,
    ) {}

    /**
     * @param  iterable<int, Order>  $orders  any status; only the placed ones are answered
     * @return array<string, int> open minutes keyed by order id
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

        foreach ($placed as $id => $order) {
            $spans[$id] = ['branch_ids' => $serving[$id], 'from' => $order->placed_at];
        }

        return $this->schedule->openMinutesForEach($spans, $at);
    }
}
