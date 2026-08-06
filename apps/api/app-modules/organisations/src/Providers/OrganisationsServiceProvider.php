<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Providers;

use Healthy360\Organisations\Services\OrganisationTradingGuard;
use Illuminate\Support\ServiceProvider;

class OrganisationsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // A singleton because the guard memoises, and the memo is only worth
        // anything if the several seams that ask about the same seller inside
        // one request share it (PA1).
        $this->app->singleton(OrganisationTradingGuard::class);
    }
}
