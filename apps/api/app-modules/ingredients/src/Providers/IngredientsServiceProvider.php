<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Providers;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Services\NullIngredientUsageRegistry;
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

        // Scoped, not bound fresh: "is this caller the platform operator?" costs an organisation
        // lookup, the answer cannot change inside one request, and the presenter asks it once per
        // row of a 25-row page. Scoped rather than a plain singleton because the answer is about
        // the caller, so it must not survive into the next request — or, in the test suite, into
        // the next tenant context.
        $this->app->scoped(PlatformLibraryAccess::class);
    }
}
