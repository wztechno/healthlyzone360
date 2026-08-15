<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Providers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Console\DeriveStockItemsCommand;
use Healthy360\Inventory\Observers\DerivedStockObserver;
use Healthy360\Inventory\Services\OrderConsumptionService;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\ServiceProvider;

class InventoryServiceProvider extends ServiceProvider
{
    /**
     * The models a derived stock item is derived *from* (INV2.0).
     *
     * @var list<class-string<Model>>
     */
    private const array STOCK_DERIVING_MODELS = [
        Ingredient::class,
        CatalogueItem::class,
    ];

    public function register(): void {}

    /**
     * Answer the orders module's stock-consumption port with real inventory
     * deduction (INV1.2), and keep derived stock in step with the catalogue
     * (INV2.0).
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

        foreach (self::STOCK_DERIVING_MODELS as $model) {
            $model::observe(DerivedStockObserver::class);
        }

        if ($this->app->runningInConsole()) {
            $this->commands([DeriveStockItemsCommand::class]);
        }
    }
}
