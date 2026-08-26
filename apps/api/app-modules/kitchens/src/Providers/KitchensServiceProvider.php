<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Providers;

use Healthy360\Kitchens\Console\ActivateImportedTariffsCommand;
use Healthy360\Kitchens\Console\ApplyAllergenDeterminationsCommand;
use Healthy360\Kitchens\Console\ImportKitchenWorkbookCommand;
use Healthy360\Kitchens\Console\ImportV6CatalogueCommand;
use Healthy360\Kitchens\Console\ImportV6RecipesCommand;
use Healthy360\Kitchens\Console\PublishReadyCatalogueCommand;
use Healthy360\Kitchens\Console\SeedApproximatePlanPricesCommand;
use Illuminate\Support\ServiceProvider;

/**
 * The kitchens module binds nothing.
 *
 * Its services are constructor-injected concretes the container resolves by
 * autowiring, and there is no port here for another module to swap. What it
 * does register are the console commands — the private Healthy360 kitchen workbook importer K1.8
 * added, and the three DEC1 data commands that carry out the product owner's
 * allergen, pricing and publication decisions — and only when running in the
 * console, so nothing about any of them is reachable from an HTTP request.
 */
class KitchensServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                ImportKitchenWorkbookCommand::class,
                ImportV6CatalogueCommand::class,
                ImportV6RecipesCommand::class,
                ActivateImportedTariffsCommand::class,
                ApplyAllergenDeterminationsCommand::class,
                SeedApproximatePlanPricesCommand::class,
                PublishReadyCatalogueCommand::class,
            ]);
        }
    }
}
