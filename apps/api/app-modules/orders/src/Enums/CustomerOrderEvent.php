<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/** What a customer is told about their order. The value is the `notices.order` key. */
enum CustomerOrderEvent: string
{
    case Confirmed = 'confirmed';

    case OutForDelivery = 'out_for_delivery';

    case Delivered = 'delivered';

    case Cancelled = 'cancelled';

    case DeliveryFailed = 'delivery_failed';
}
