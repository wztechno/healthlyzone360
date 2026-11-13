<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

/**
 * Which meal went in which sitting of a subscription day's order.
 *
 * A generated plan day is one order: the plan line, and one zero-priced line
 * per dish. The lines say *what* was packed but not *for which sitting* — the
 * slot lives on the customer's meal choice, in the subscriptions module, which
 * this module may not import (the registry edge runs Subscriptions → Orders).
 * So the order view asks through this port, and an order that is not a
 * subscription day is simply absent from the answer.
 */
interface OrderPlanDays
{
    /**
     * @param  list<string>  $orderIds
     * @return array<string, list<array{slot: string, sequence: int, catalogue_item_id: string, source: string}>> order id → the day's meals, in sitting order
     */
    public function forOrders(array $orderIds): array;
}
