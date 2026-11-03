<?php

declare(strict_types=1);

namespace Healthy360\Orders\Enums;

/**
 * Moves once at most: `PendingApproval` to `Completed` or `Rejected`. The table's
 * trigger refuses anything else.
 */
enum OrderRefundStatus: string
{
    case PendingApproval = 'pending_approval';
    case Completed = 'completed';
    case Rejected = 'rejected';
}
