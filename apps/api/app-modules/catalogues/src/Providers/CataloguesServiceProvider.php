<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Providers;

use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Catalogues\Services\CatalogueIngredientUsageRegistry;
use Healthy360\Catalogues\Services\CatalogueRecipeUsageRegistry;
use Healthy360\Catalogues\Services\NullConfirmedPriceRegistry;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

class CataloguesServiceProvider extends ServiceProvider
{
    /**
     * The default answer to "which of these variants has a confirmed price":
     * **none of them** (K1.6).
     *
     * Registered here rather than left unbound, so the catalogue is coherent
     * with no pricing module at all — the same argument
     * `IngredientsServiceProvider` makes about its own port. The pricing module
     * replaces this binding with one that can actually answer.
     *
     * Fail-closed by design: see `NullConfirmedPriceRegistry` for why the
     * optimistic default would be the dangerous one.
     */
    public function register(): void
    {
        $this->app->bind(ConfirmedPriceRegistry::class, NullConfirmedPriceRegistry::class);
    }

    /**
     * Answer the recipes module's usage question with real catalogue data.
     *
     * A plain replacement, because the recipes module binds a null object and
     * nobody else answers this question. Declared in `boot()` for the reason
     * `RecipesServiceProvider` gives: every `register()` runs before any
     * `boot()`, so an override declared here wins whatever order package
     * discovery puts the two modules in.
     */
    public function boot(): void
    {
        $this->app->bind(RecipeUsageRegistry::class, CatalogueRecipeUsageRegistry::class);

        $this->decorateIngredientUsageRegistry();
    }

    /**
     * Add the catalogue's half of the ingredient usage answer **without
     * discarding the recipes module's**.
     *
     * `extend` rather than `bind`, from inside an `app->booted()` callback
     * rather than from `boot()` directly. Both halves matter:
     *
     * - `extend` wraps whatever implementation is registered, so the composed
     *   registry reports formulations *and* listings. A `bind` here would
     *   silently drop the recipe answer and make an ingredient used by a live
     *   formulation archivable again.
     * - `booted()` runs after every provider's `boot()`, so the wrapping
     *   happens once the recipes module has installed its implementation.
     *   Wrapping from `boot()` would leave the composition depending on which
     *   of "catalogues" and "recipes" package discovery happens to sort first
     *   — a guarantee nobody wrote down, and one alphabetical order gets wrong
     *   in exactly this pair.
     */
    private function decorateIngredientUsageRegistry(): void
    {
        $this->app->booted(function (Application $app): void {
            $app->extend(
                IngredientUsageRegistry::class,
                static fn (IngredientUsageRegistry $inner, Application $container): IngredientUsageRegistry => new CatalogueIngredientUsageRegistry(
                    $inner,
                    $container->make(TenantContext::class),
                ),
            );
        });
    }
}
