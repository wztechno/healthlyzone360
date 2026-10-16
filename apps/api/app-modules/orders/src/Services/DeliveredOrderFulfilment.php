<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Contracts\DeliveredOrderHandover;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The driver's handover, as the order lifecycle's own fulfilment.
 *
 * Through `OrderLifecycle::fulfil()` rather than a column write, so the
 * transition rules, the audit entry and the cash receipt are the ones the
 * desk's Mark fulfilled produces — with the driver as the actor, which is what
 * puts cash on delivery against the driver in the cash report.
 */
final class DeliveredOrderFulfilment implements DeliveredOrderHandover
{
    public function __construct(private readonly OrderLifecycle $lifecycle) {}

    /**
     * @throws ApiException
     */
    public function delivered(string $orderId): void
    {
        $order = Order::query()->whereKey($orderId)->first();

        if (! $order instanceof Order || ! $order->status->canTransitionTo(OrderStatus::Fulfilled)) {
            return;
        }

        $this->lifecycle->fulfil($order);
    }
}
