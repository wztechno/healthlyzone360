<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Contracts;

/**
 * "Does this customer still hold a live subscription?"
 *
 * **Declared here and consumed elsewhere**, which is the opposite direction
 * from most ports in this codebase and is deliberate. J2's account closure has
 * to know whether a customer has a standing arrangement before it may close or
 * anonymise them — a live subscription is food somebody is still expecting, and
 * closing the account underneath it would generate orders for a person who no
 * longer exists. Closure must depend on that one fact rather than on this
 * module's models, so the interface is what it depends on, and the real
 * implementation is bound in `SubscriptionsServiceProvider`.
 *
 * It is the twin of `OpenOrderQuery`, which Orders declares and binds for
 * exactly the same reason, and it is shaped the same way on purpose: the
 * consumer stays testable against a stub, and the dependency edge runs
 * Customers → Subscriptions rather than the reverse.
 *
 * **A default binding exists on both sides.** This module binds the real
 * implementation; J2 declares a null default of its own so that closure keeps
 * working in a deployment where this module is absent. The two are not a
 * conflict — the module that is present wins, and a closure that silently
 * assumed "no subscriptions" because the binding was missing is precisely the
 * failure a null *default* makes visible rather than invisible.
 */
interface SubscriptionQuery
{
    /**
     * Whether the customer holds any subscription that is still live —
     * `active` or `paused`. A cancelled or completed one is history and blocks
     * nothing.
     *
     * @param  string  $customerAccountId  a `customer_accounts` identifier
     */
    public function hasActiveSubscriptions(string $customerAccountId): bool;

    /**
     * How many live subscriptions the customer holds, for a surface that has to
     * say "you have two standing plans" rather than merely "you have one".
     */
    public function activeSubscriptionCount(string $customerAccountId): int;

    /**
     * Whether any delivery is already scheduled or generated for the customer
     * on or after today.
     *
     * Distinct from `hasActiveSubscriptions()` and not implied by it: a paused
     * subscription is live and has nothing coming, and a subscription cancelled
     * inside the 24-hour window still has tomorrow's order on its way. Closure
     * cares about food in transit, which is this question and not the other.
     */
    public function hasUpcomingDeliveries(string $customerAccountId): bool;
}
