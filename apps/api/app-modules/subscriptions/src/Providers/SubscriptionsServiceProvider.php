<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Providers;

use Healthy360\Subscriptions\Console\GenerateSubscriptionDeliveriesCommand;
use Healthy360\Subscriptions\Contracts\MealSafety;
use Healthy360\Subscriptions\Contracts\SubscriptionQuery;
use Healthy360\Subscriptions\Services\MealSafetyService;
use Healthy360\Subscriptions\Services\SubscriptionQueryService;
use Illuminate\Support\ServiceProvider;

/**
 * The two ports this module has, pointing in opposite directions.
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
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([GenerateSubscriptionDeliveriesCommand::class]);
        }
    }
}
