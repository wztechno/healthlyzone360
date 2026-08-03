<?php

declare(strict_types=1);

namespace Healthy360\Orders\Providers;

use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Orders\Contracts\OpenOrderQuery;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Services\BranchScheduleLookup;
use Healthy360\Orders\Services\BuyerOpenOrderQuery;
use Healthy360\Orders\Services\OrderQuery;
use Healthy360\Orders\Services\OrderSnapshotRedaction;
use Illuminate\Support\ServiceProvider;

/**
 * Every port this module either declares or answers, in one place.
 *
 * **Two it declares**, both bound here because this module is the consumer
 * stating what it needs, which is what keeps the dependency graph pointing the
 * way the registry says it does:
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
 *
 * **Two it answers for other modules**, both added by the integration wave and
 * both bound here for the same structural reason: the module that owns the
 * columns is the one that can keep the answer current as columns are added.
 *
 *  * J2's `OrderAnonymisation` → `OrderSnapshotRedaction`. This supersedes
 *    `OrderSnapshotAnonymiser`, the schema-guarded fallback the customers
 *    module registers with `bindIf` and whose own docblock asks for exactly
 *    this. The fallback stays where it is — a deployment without orders still
 *    needs an honest `isAvailable() = false` — and simply stops being resolved.
 *  * B2's `SellerOpenOrders` → `BuyerOpenOrderQuery`, replacing
 *    `NoSellerOpenOrders`. That default answers *unavailable* rather than
 *    *nothing outstanding*, so binding this is what turns one `not_applicable`
 *    on a wind-up's settlement summary into a check that can actually refuse.
 *
 * Both are `bind` rather than `bindIf`, over the neighbours' `bindIf` defaults:
 * the null answers exist for a deployment without this module, and where this
 * module is present it must win regardless of provider order.
 */
class OrdersServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderSchedulingLookup::class, BranchScheduleLookup::class);
        $this->app->bind(OpenOrderQuery::class, OrderQuery::class);

        $this->app->bind(OrderAnonymisation::class, OrderSnapshotRedaction::class);
        $this->app->bind(SellerOpenOrders::class, BuyerOpenOrderQuery::class);
    }

    public function boot(): void {}
}
