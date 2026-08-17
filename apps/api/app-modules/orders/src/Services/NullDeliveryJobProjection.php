<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Contracts\DeliveryJobProjection;
use Healthy360\Orders\Models\Order;

/**
 * The answer when no delivery module is installed: an order confirms, and
 * nobody is dispatched.
 *
 * Bound by `OrdersServiceProvider` and replaced by the delivery module's real
 * projector when that module is present. The null object exists so the order
 * lifecycle keeps working — and keeps being testable — without delivery, rather
 * than resolving to an unbound interface and failing at the container the first
 * time a kitchen confirms an order for a door.
 */
final class NullDeliveryJobProjection implements DeliveryJobProjection
{
    public function project(Order $order): void {}
}
