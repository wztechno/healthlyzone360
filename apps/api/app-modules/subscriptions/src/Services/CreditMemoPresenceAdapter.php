<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Customers\Closure\Contracts\CustomerCreditPresence;
use Healthy360\Subscriptions\Enums\CreditMemoStatus;
use Healthy360\Subscriptions\Models\CreditMemo;

/**
 * J2's `CustomerCreditPresence`, over this module's credit memos.
 *
 * The twin of `SubscriptionPresenceAdapter` and bound the same way: the adapter
 * lives on this side of the seam because closure must not import anything from
 * Subscriptions, and `isAvailable()` is true unconditionally because the only
 * way this class is reached is that this module is bound.
 *
 * `recorded` only. `settled` means a human has stated the money changed hands,
 * which is exactly the point at which the obligation stops being something a
 * closure screen needs to mention.
 */
final readonly class CreditMemoPresenceAdapter implements CustomerCreditPresence
{
    public function isAvailable(): bool
    {
        return true;
    }

    public function unsettledCreditCount(string $customerAccountId): int
    {
        return CreditMemo::query()
            ->where('customer_account_id', $customerAccountId)
            ->where('status', CreditMemoStatus::Recorded->value)
            ->count();
    }
}
