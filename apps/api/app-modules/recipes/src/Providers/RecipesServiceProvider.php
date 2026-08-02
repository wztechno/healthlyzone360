<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Providers;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Services\NullRecipeUsageRegistry;
use Healthy360\Recipes\Services\RecipeIngredientUsageRegistry;
use Illuminate\Support\ServiceProvider;

class RecipesServiceProvider extends ServiceProvider
{
    /**
     * The default answer to "what else sells this recipe": nothing.
     *
     * The mirror of the ingredients module's own null binding, one level up. A
     * module that depends on recipes replaces it with one that can answer (the
     * catalogues module does, in K1.4). Registered here rather than left
     * unbound so the recipe lifecycle is complete — and testable — on its own.
     */
    public function register(): void
    {
        $this->app->bind(RecipeUsageRegistry::class, NullRecipeUsageRegistry::class);
    }

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
     *
     * The catalogues module *decorates* this binding rather than replacing it,
     * from an `app->booted()` callback, so both answers compose whatever order
     * the two providers boot in (K1.4).
     */
    public function boot(): void
    {
        $this->app->bind(IngredientUsageRegistry::class, RecipeIngredientUsageRegistry::class);
    }
}
