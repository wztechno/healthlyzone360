<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use Healthy360\Customers\Closure\Contracts\SubscriptionPresence;

/**
 * The answer when no subscriptions module is bound: **we did not look**.
 *
 * Not "you have none". The counts are zero because there is nothing to count
 * them from, and `isAvailable()` is the field that says so — which is what
 * turns the blocker's verdict into `not_applicable` with a reason naming the
 * absent module, rather than a `clear` that a customer would reasonably read as
 * "my standing plans have been checked".
 *
 * **This default is temporary by design and by schedule.** The subscriptions
 * module lands in the same wave as this one, and integrator-2 binds an adapter
 * over its `SubscriptionQuery` onto `SubscriptionPresence`; from that moment
 * the blocker is real and this class is dead weight nobody resolves. A
 * `not_applicable` that outlived its wave would be the permanently-false
 * blocker the master plan (§9) refuses to ship, which is why it is written down
 * here as an expiry rather than left as an assumption.
 */
final class NullSubscriptionPresence implements SubscriptionPresence
{
    public function isAvailable(): bool
    {
        return false;
    }

    public function activeSubscriptionCount(string $customerAccountId): int
    {
        return 0;
    }

    public function hasUpcomingDeliveries(string $customerAccountId): bool
    {
        return false;
    }
}
