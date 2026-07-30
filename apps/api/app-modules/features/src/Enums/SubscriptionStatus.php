<?php

declare(strict_types=1);

namespace Healthy360\Features\Enums;

enum SubscriptionStatus: string
{
    case Trial = 'trial';
    case Active = 'active';
    case Lapsed = 'lapsed';
    case Cancelled = 'cancelled';
}
