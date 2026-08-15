<?php

declare(strict_types=1);

namespace Healthy360\Payments\Enums;

enum PaymentIntentStatus: string
{
    case Pending = 'pending';
    case Authorized = 'authorized';
    case Captured = 'captured';
    case Failed = 'failed';
    case Cancelled = 'cancelled';
}
