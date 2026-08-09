<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Providers;

use Healthy360\Inventory\Services\OrderConsumptionService;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Illuminate\Support\ServiceProvider;

class InventoryServiceProvider extends ServiceProvider
{
    public function register(): void {}

    /**
     * Answer the orders module's stock-consumption port with real inventory
     * deduction (INV1.2).
     *
     * The orders module binds a null implementation of its own port; this
     * replaces it. Registered from the *downstream* module — Inventory → Orders
     * is the declared edge — so orders never learns inventory exists, it only
     * learns that somebody can answer when it confirms an order.
     *
     * In `boot()` rather than `register()` on purpose, the same reason the
     * recipes module binds `IngredientUsageRegistry` there: every provider's
     * `register()` runs before any `boot()`, so an override declared here wins
     * whatever order package discovery happens to put the two modules in.
     */
    public function boot(): void
    {
        $this->app->bind(OrderStockConsumption::class, OrderConsumptionService::class);
    }
}
