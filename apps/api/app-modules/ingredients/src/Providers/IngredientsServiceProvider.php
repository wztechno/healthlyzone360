<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Providers;

use Healthy360\Ingredients\Console\ImportIngredientNutritionCommand;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Services\NullIngredientUsageRegistry;
use Healthy360\Ingredients\Services\NullIngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Services\PlatformLibraryAccess;
use Illuminate\Support\ServiceProvider;

class IngredientsServiceProvider extends ServiceProvider
{
    /**
     * The default answer to "what else is using this ingredient": nothing.
     *
     * A module that depends on ingredients replaces this binding with one that
     * can actually answer (the recipes module does, in K1.2). Registered here
     * rather than left unbound so the ingredient catalogue is complete on its
     * own — an unbound interface would make K1.1 depend on K1.2 existing,
     * which is the coupling the port exists to avoid.
     */
    public function register(): void
    {
        $this->app->bind(IngredientUsageRegistry::class, NullIngredientUsageRegistry::class);

        // The same port shape, for the estimating price. Procurement owns the
        // goods-receipt ledger the figure is computed from and binds the real
        // implementation over this one in its `boot()`; declaring the question
        // here — upstream of Recipes, Inventory and Procurement alike — is what
        // keeps `Recipes -> Procurement` out of the graph, where it would close a
        // cycle against `Procurement -> Inventory -> Recipes`.
        $this->app->bind(IngredientWeeklyPriceLookup::class, NullIngredientWeeklyPriceLookup::class);

        // Scoped, not bound fresh: "is this caller the platform operator?" costs an organisation
        // lookup, the answer cannot change inside one request, and the presenter asks it once per
        // row of a 25-row page. Scoped rather than a plain singleton because the answer is about
        // the caller, so it must not survive into the next request — or, in the test suite, into
        // the next tenant context.
        $this->app->scoped(PlatformLibraryAccess::class);
    }

    /**
     * One console command, registered only in the console, so nothing about it
     * is reachable from an HTTP request. It re-applies the platform nutrition
     * document — reference data, not a tenant's own rows, which is why it needs
     * neither an environment gate nor an organisation to run inside.
     */
    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                ImportIngredientNutritionCommand::class,
            ]);
        }
    }
}
