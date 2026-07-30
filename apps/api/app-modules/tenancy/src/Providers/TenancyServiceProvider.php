<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Providers;

use Healthy360\Tenancy\TenantContext;
use Illuminate\Log\Context\Repository as ContextRepository;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class TenancyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(TenantContext::class);
    }

    /**
     * Wire tenant-context propagation into the queue: the context snapshot is
     * dehydrated into every job payload via Laravel Context, restored when the
     * worker hydrates it, and reset after each job so a reused worker process
     * never retains a previous tenant's context (verified end-to-end in
     * Phase 6).
     */
    public function boot(): void
    {
        Context::dehydrating(function (ContextRepository $context): void {
            $context->addHidden('healthy360:tenancy', $this->app->make(TenantContext::class)->toArray());
        });

        Context::hydrated(function (ContextRepository $context): void {
            $tenant = $this->app->make(TenantContext::class);
            $snapshot = $context->getHidden('healthy360:tenancy');

            if (is_array($snapshot)) {
                /** @var array{user_id?: string|null, organisation_id?: string|null, branch_id?: string|null} $snapshot */
                $tenant->restore($snapshot);
            } else {
                $tenant->clear();
            }
        });

        Event::listen(JobProcessed::class, fn () => $this->app->make(TenantContext::class)->clear());
        Event::listen(JobFailed::class, fn () => $this->app->make(TenantContext::class)->clear());
    }
}
