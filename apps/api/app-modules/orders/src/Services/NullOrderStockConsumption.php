<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Models\Order;

/**
 * The answer when no inventory module is installed: an order confirms and
 * cancels, and nothing on a shelf moves.
 *
 * Bound by `OrdersServiceProvider` and replaced by the inventory module's real
 * implementation when that module is present. The null object exists so the
 * order lifecycle keeps working — and keeps being testable — without inventory,
 * rather than resolving to an unbound interface and failing at the container the
 * first time a kitchen confirms an order.
 */
final class NullOrderStockConsumption implements OrderStockConsumption
{
    public function consume(Order $order): void {}

    public function restore(Order $order): void {}
}
