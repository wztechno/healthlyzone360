<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Contracts;

/**
 * "Does this customer still have a standing arrangement?"
 *
 * **Declared here rather than imported from Subscriptions, and the extra method
 * is why.** The subscriptions module declares `SubscriptionQuery`, which is the
 * right shape for anybody who knows the module exists. Closure does not get to
 * assume that: it must run in a deployment where subscriptions have not been
 * built, and it must be able to *say* that is what happened rather than quietly
 * reporting "no subscriptions" — a screen that tells somebody their standing
 * plans are clear when nothing looked is the exact dishonesty the blocker
 * registry exists to prevent.
 *
 * So this port is `SubscriptionQuery` plus `isAvailable()`. The null default
 * (`NullSubscriptionPresence`) answers false and the blocker reports
 * `not_applicable` with a reason naming the absent module; the real adapter
 * wraps `SubscriptionQuery`, answers true, and the blocker becomes real without
 * the blocker changing.
 *
 * **Binding is the integrator's** (integrator-2, this wave): an adapter over
 * `Healthy360\Subscriptions\Contracts\SubscriptionQuery` bound onto this
 * interface. Three delegating methods and a `return true` — deliberately
 * trivial, so that the seam costs nothing to close.
 *
 * The dependency edge runs Customers → Subscriptions and never the reverse;
 * this file names the neighbour in prose rather than importing it, because an
 * import here would be the edge the port exists to avoid.
 */
interface SubscriptionPresence
{
    /**
     * Whether anything in this deployment can answer the questions below.
     *
     * False means "no subscriptions module is bound", which is a fact about the
     * platform and is reported as such. It never means "no subscriptions".
     */
    public function isAvailable(): bool;

    /**
     * How many live subscriptions the customer holds — active or paused. A
     * cancelled or completed one is history and blocks nothing.
     *
     * @param  string  $customerAccountId  a `customer_accounts` identifier
     */
    public function activeSubscriptionCount(string $customerAccountId): int;

    /**
     * Whether any delivery is already scheduled or generated on or after today.
     *
     * Not implied by the count above and asked separately for that reason: a
     * paused subscription is live with nothing coming, and one cancelled inside
     * the notice window still has tomorrow's food on its way. Closure cares
     * about food in transit, which is this question.
     */
    public function hasUpcomingDeliveries(string $customerAccountId): bool;
}
