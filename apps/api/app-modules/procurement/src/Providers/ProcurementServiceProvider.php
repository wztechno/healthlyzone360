<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Providers;

use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Procurement\Console\PublishWeeklyPricesCommand;
use Healthy360\Procurement\Services\WeeklyPriceLookup;
use Illuminate\Support\ServiceProvider;

class ProcurementServiceProvider extends ServiceProvider
{
    public function register(): void {}

    /**
     * The real answer to "what did this ingredient cost on average last week",
     * bound over the null default the ingredients module registers.
     *
     * In `boot()` rather than `register()`, which is the house pattern for an
     * inverted port and not a stylistic choice: every provider's `register()` runs
     * before any provider's `boot()`, so the override wins whatever order package
     * discovery happens to put the two modules in.
     */
    public function boot(): void
    {
        $this->app->bind(IngredientWeeklyPriceLookup::class, WeeklyPriceLookup::class);

        if ($this->app->runningInConsole()) {
            $this->commands([
                PublishWeeklyPricesCommand::class,
            ]);
        }
    }
}
