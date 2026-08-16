<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Providers;

use Healthy360\Delivery\Services\DeliveryJobProjector;
use Healthy360\Orders\Contracts\DeliveryJobProjection;
use Illuminate\Support\ServiceProvider;

/**
 * The delivery module binds one thing, and it is somebody else's port.
 *
 * Its own services are constructor-injected concretes the container resolves by
 * autowiring, and it publishes no port for another module to implement.
 * `ZoneResolver` — the class J1's address validation and C1's checkout call —
 * is deliberately a concrete rather than an interface: a delivery precedence
 * with two implementations is two precedences.
 */
class DeliveryServiceProvider extends ServiceProvider
{
    public function register(): void {}

    /**
     * Answer the orders module's delivery-job port with real dispatch (C3).
     *
     * The orders module binds a null implementation of its own port; this
     * replaces it, so that confirming a delivery order creates the run a driver
     * works while orders never learns that a `delivery_jobs` table exists. The
     * write stays in the module that owns the table, which is the point of the
     * port: the registry edge runs Orders → Delivery for the zone fee, and
     * orders inserting into this table would make that coupling mutual.
     *
     * In `boot()` rather than `register()` on purpose, the same reason the
     * inventory module binds `OrderStockConsumption` there: every provider's
     * `register()` runs before any `boot()`, so an override declared here wins
     * whatever order package discovery happens to put the two modules in.
     */
    public function boot(): void
    {
        $this->app->bind(DeliveryJobProjection::class, DeliveryJobProjector::class);
    }
}
