<?php

declare(strict_types=1);

namespace Healthy360\Support\Providers;

use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Support\ServiceProvider;

class SupportServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(IdentifierService::class);
    }
}
