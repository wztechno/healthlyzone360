<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use Healthy360\Customers\Closure\Contracts\CustomerCreditPresence;

/**
 * The answer when nothing records what the platform owes customers: **we did
 * not look**.
 *
 * Not "nothing is owed". The count is zero because there is nothing to count it
 * from, and `isAvailable()` is the field that says so — which is what turns
 * `CreditMemoBlocker`'s verdict into `not_applicable` with a reason naming the
 * absent module, rather than a `clear` that a customer would reasonably read as
 * "my refunds have been checked".
 *
 * The same shape and the same expiry as `NullSubscriptionPresence`: the module
 * that can answer is bound over it, and this class becomes something nobody
 * resolves.
 */
final class NullCustomerCreditPresence implements CustomerCreditPresence
{
    public function isAvailable(): bool
    {
        return false;
    }

    public function unsettledCreditCount(string $customerAccountId): int
    {
        return 0;
    }
}
