<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Providers;

use Healthy360\Kitchens\Console\ImportGreenLifeCommand;
use Illuminate\Support\ServiceProvider;

/**
 * The kitchens module binds nothing.
 *
 * Its services are constructor-injected concretes the container resolves by
 * autowiring, and there is no port here for another module to swap. What it
 * does register is the one console command K1.8 adds — the private GreenLife
 * importer — and only when running in the console, so nothing about it is
 * reachable from an HTTP request.
 */
class KitchensServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([ImportGreenLifeCommand::class]);
        }
    }
}
