<?php

declare(strict_types=1);

namespace Healthy360\Support\Providers;

use Healthy360\Support\Api\ApiExceptionRenderer;
use Healthy360\Support\Correlation\CorrelationContext;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Support\ServiceProvider;

class SupportServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(IdentifierService::class);
        $this->app->singleton(ApiExceptionRenderer::class);

        // Scoped: one correlation identifier per request, reset between
        // requests in long-lived workers (Octane, queue workers).
        $this->app->scoped(CorrelationContext::class);
    }

    public function boot(): void
    {
        // The shared operational notice (`NoticeMessage`): the API registers no
        // application view path, so module templates resolve by namespace.
        $this->loadViewsFrom(__DIR__.'/../../resources/views', 'support');
    }
}
