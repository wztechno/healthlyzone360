<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Customers\Closure\Contracts\SubscriptionPresence;
use Healthy360\Subscriptions\Contracts\SubscriptionQuery;

/**
 * J2's `SubscriptionPresence`, over this module's own `SubscriptionQuery`.
 *
 * **Three delegating methods and a `return true`**, which is precisely what the
 * port's docblock predicted and asked for. The two interfaces are the same
 * question asked by two modules with different amounts of knowledge:
 * `SubscriptionQuery` is what a module that knows subscriptions exist wants,
 * and `SubscriptionPresence` is that plus `isAvailable()`, because closure has
 * to run in a deployment where this module was never built and must be able to
 * *say* so rather than quietly reporting "no subscriptions".
 *
 * `isAvailable()` returns true unconditionally, and it is not a stub. The
 * question it answers is "is a subscriptions module bound", and the only way
 * this class is reached is that one is — `CustomersServiceProvider` binds
 * `NullSubscriptionPresence` with `bindIf`, and `SubscriptionsServiceProvider`
 * overrides it with this. A `Schema::hasTable` guard here would be answering a
 * different question than the one asked, and would turn a migration that had
 * not run into "you have no standing plans" on an erasure screen.
 *
 * The adapter lives on **this** side of the seam. Closure must not import
 * anything from Subscriptions — the port file says as much and names the
 * neighbour in prose rather than in a `use` — so the class that names both
 * interfaces belongs to the module that may know about both.
 */
final readonly class SubscriptionPresenceAdapter implements SubscriptionPresence
{
    public function __construct(private SubscriptionQuery $subscriptions) {}

    public function isAvailable(): bool
    {
        return true;
    }

    public function activeSubscriptionCount(string $customerAccountId): int
    {
        return $this->subscriptions->activeSubscriptionCount($customerAccountId);
    }

    public function hasUpcomingDeliveries(string $customerAccountId): bool
    {
        return $this->subscriptions->hasUpcomingDeliveries($customerAccountId);
    }
}
