<?php

declare(strict_types=1);

namespace Healthy360\Orders\Providers;

use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Orders\Contracts\DeliveryJobProjection;
use Healthy360\Orders\Contracts\OpenOrderQuery;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Contracts\SubscriptionOutlook;
use Healthy360\Orders\Services\BranchScheduleLookup;
use Healthy360\Orders\Services\BuyerOpenOrderQuery;
use Healthy360\Orders\Services\NullDeliveryJobProjection;
use Healthy360\Orders\Services\NullOrderStockConsumption;
use Healthy360\Orders\Services\NullSubscriptionOutlook;
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
 *
 * **Three it declares and answers with a null default**, all pointing *outward*,
 * so that this module can have consequences in — and ask questions of — modules
 * it never learns the names of. The module that owns each answer binds the real
 * implementation over the default from its own `boot()`; where that module is
 * absent, the null answer is the honest one rather than a degraded one.
 *
 *  * INV1.2's `OrderStockConsumption` → `NullOrderStockConsumption`, so that
 *    confirming takes ingredients off the shelf without this module ever
 *    learning that an inventory module exists.
 *  * C3's `DeliveryJobProjection` → `NullDeliveryJobProjection`, so that
 *    confirming a *delivery* order creates the job a driver runs. This one is
 *    the port pattern doing work the other does not: the registry edge already
 *    runs Orders → Delivery for the zone fee, so without a port this module
 *    would be inserting rows into another module's table and the coupling would
 *    be mutual. Declaring the question here keeps the write where the table is.
 *  * C4's `SubscriptionOutlook` → `NullSubscriptionOutlook`, so that the desk
 *    calendar can show what a kitchen owes that nobody has ordered yet. The
 *    first of the three that is a *question* rather than a consequence, and the
 *    only one whose edge could not simply be imported: Subscriptions → Orders is
 *    a declared edge, so this module reaching back would be the cycle the
 *    architecture test rejects. Two empty lists is what a deployment with no
 *    standing arrangements truthfully has.
 */
class OrdersServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(OrderSchedulingLookup::class, BranchScheduleLookup::class);
        $this->app->bind(OpenOrderQuery::class, OrderQuery::class);

        $this->app->bind(OrderAnonymisation::class, OrderSnapshotRedaction::class);
        $this->app->bind(SellerOpenOrders::class, BuyerOpenOrderQuery::class);

        $this->app->bind(OrderStockConsumption::class, NullOrderStockConsumption::class);
        $this->app->bind(DeliveryJobProjection::class, NullDeliveryJobProjection::class);
        $this->app->bind(SubscriptionOutlook::class, NullSubscriptionOutlook::class);
    }

    public function boot(): void {}
}
