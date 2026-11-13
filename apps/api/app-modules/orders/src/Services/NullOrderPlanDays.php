<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Contracts\OrderPlanDays;

/**
 * The answer when no subscriptions module is installed: no order is a plan day.
 *
 * Bound by `OrdersServiceProvider` and replaced by the subscriptions module's
 * adapter when that module is present.
 */
final class NullOrderPlanDays implements OrderPlanDays
{
    /**
     * @param  list<string>  $orderIds
     * @return array<string, list<array{slot: string, sequence: int, catalogue_item_id: string, source: string}>>
     */
    public function forOrders(array $orderIds): array
    {
        return [];
    }
}
