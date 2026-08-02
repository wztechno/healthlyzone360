<?php

declare(strict_types=1);

namespace Healthy360\Orders\Providers;

use Healthy360\Orders\Contracts\OpenOrderQuery;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Services\BranchScheduleLookup;
use Healthy360\Orders\Services\OrderQuery;
use Illuminate\Support\ServiceProvider;

/**
 * The two ports this module declares, and where each is satisfied.
 *
 * Both are bound here rather than in the module on the other side, because in
 * both cases this module is the consumer stating what it needs. That is what
 * keeps the dependency graph pointing the way the registry says it does:
 *
 *  * `OrderSchedulingLookup` → `BranchScheduleLookup`, an adapter over the
 *    Kitchens module's branch opening hours. Orders → Kitchens is a declared
 *    edge; a reverse binding, with Kitchens knowing what an order is, would
 *    not be.
 *  * `OpenOrderQuery` → `OrderQuery`. This one points *outward*: J2's account
 *    closure has to know whether a customer has food on its way before it may
 *    anonymise their address, and the interface is what lets closure depend on
 *    that one fact rather than on the order model — and be tested against a
 *    stub rather than against a placed order.
 */
class OrdersServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderSchedulingLookup::class, BranchScheduleLookup::class);
        $this->app->bind(OpenOrderQuery::class, OrderQuery::class);
    }

    public function boot(): void {}
}
