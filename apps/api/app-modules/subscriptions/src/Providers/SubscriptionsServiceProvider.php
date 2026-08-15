<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Providers;

use Healthy360\Customers\Closure\Contracts\CustomerCreditPresence;
use Healthy360\Customers\Closure\Contracts\SubscriptionPresence;
use Healthy360\Subscriptions\Console\GenerateSubscriptionDeliveriesCommand;
use Healthy360\Subscriptions\Contracts\MealSafety;
use Healthy360\Subscriptions\Contracts\SubscriptionQuery;
use Healthy360\Subscriptions\Services\CreditMemoPresenceAdapter;
use Healthy360\Subscriptions\Services\MealSafetyService;
use Healthy360\Subscriptions\Services\SubscriptionPresenceAdapter;
use Healthy360\Subscriptions\Services\SubscriptionQueryService;
use Illuminate\Support\ServiceProvider;

/**
 * The ports this module has, pointing in opposite directions.
 *
 *  * `MealSafety` → `MealSafetyService`. An **inward** port: generation needs
 *    one verdict assembled from the customer's declarations and the meal's
 *    derived allergen label, and declaring the need here keeps the allergen
 *    rule out of the substitution search and the substitution search out of
 *    Catalogues. It is also what lets the kept smoke test prove the refusal
 *    against a stub rather than against a whole recipe.
 *  * `SubscriptionQuery` → `SubscriptionQueryService`. An **outward** port,
 *    bound here for the reason `OrdersServiceProvider` gives about
 *    `OpenOrderQuery`: J2's account closure must know whether a customer holds
 *    a standing arrangement, and it must depend on that one fact rather than on
 *    this module's models. Binding it on this side is what keeps the edge
 *    running Customers → Subscriptions and the graph acyclic.
 *
 * **Two of J2's own ports are satisfied here too**, and they are bound with
 * `bind` rather than `bindIf` on purpose. `CustomersServiceProvider` registers
 * `NullSubscriptionPresence` and `NullCustomerCreditPresence` with `bindIf`,
 * whose whole job is to be honest about a deployment where this module does not
 * exist. In a deployment where it does, this provider is the one that must win,
 * and a `bindIf` here would make the winner depend on provider order — which is
 * exactly the silent "you have no standing plans" an erasure screen must never
 * show. The adapters are on this side of the seam because Customers may not
 * import Subscriptions; the ports' own docblocks say so.
 *
 * The console command is registered only when running in the console, which is
 * the framework's own convention and keeps a scheduler-only class out of every
 * HTTP request's container.
 */
class SubscriptionsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(MealSafety::class, MealSafetyService::class);
        $this->app->bind(SubscriptionQuery::class, SubscriptionQueryService::class);

        $this->app->bind(SubscriptionPresence::class, SubscriptionPresenceAdapter::class);
        $this->app->bind(CustomerCreditPresence::class, CreditMemoPresenceAdapter::class);
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([GenerateSubscriptionDeliveriesCommand::class]);
        }
    }
}
