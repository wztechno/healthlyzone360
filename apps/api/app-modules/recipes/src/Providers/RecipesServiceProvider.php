<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Providers;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Recipes\Services\RecipeIngredientUsageRegistry;
use Illuminate\Support\ServiceProvider;

class RecipesServiceProvider extends ServiceProvider
{
    /**
     * Answer the ingredients module's usage questions with real recipe data.
     *
     * The ingredients module binds a null implementation of its own port; this
     * replaces it. Registered from the *downstream* module so the dependency
     * edge stays Recipes → Ingredients — the ingredient catalogue never learns
     * that recipes exist, it only learns that somebody can answer.
     *
     * In `boot()` rather than `register()` on purpose: every provider's
     * `register()` runs before any `boot()`, so an override declared here wins
     * whatever order package discovery happens to put the two modules in.
     * Declaring it in `register()` would make the correct binding depend on
     * "ingredients" sorting before "recipes", which is true today and is not a
     * guarantee anybody wrote down.
     */
    public function boot(): void
    {
        $this->app->bind(IngredientUsageRegistry::class, RecipeIngredientUsageRegistry::class);
    }
}
