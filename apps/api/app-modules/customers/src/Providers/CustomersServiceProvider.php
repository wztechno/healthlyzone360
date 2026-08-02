<?php

declare(strict_types=1);

namespace Healthy360\Customers\Providers;

use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Customers\Services\DeliveryZoneAreaService;
use Illuminate\Support\ServiceProvider;

class CustomersServiceProvider extends ServiceProvider
{
    /**
     * The one binding this module needs: its delivery-geography port.
     *
     * Bound here rather than in the delivery module, because the dependency
     * runs Customers → Delivery. The port is declared by the consumer (this
     * module states what it needs) and satisfied by an adapter that knows both
     * sides; delivery keeps knowing nothing about customers, which is what
     * keeps the graph acyclic.
     */
    public function register(): void
    {
        $this->app->bind(AreaServiceLookup::class, DeliveryZoneAreaService::class);
    }

    public function boot(): void {}
}
