<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Providers;

use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Log\Context\Repository as ContextRepository;
use Illuminate\Queue\Events\JobAttempted;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class TenancyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(DatabaseTenantContext::class);

        // The tenant context republishes itself to the PostgreSQL session
        // variables the RLS policies read, on every mutation and wherever it
        // happens — middleware, queue restoration or a service resolving a
        // remembered workspace. Wiring it here keeps TenantContext itself a
        // plain value holder with no knowledge of the database.
        $this->app->scoped(TenantContext::class, function ($app): TenantContext {
            $context = new TenantContext;

            $context->listen(static function (TenantContext $context) use ($app): void {
                $app->make(DatabaseTenantContext::class)->apply(
                    $context->userId(),
                    $context->organisationId(),
                    $context->branchId(),
                );
            });

            return $context;
        });
    }

    /**
     * Wire tenant-context propagation into the queue and into connection
     * recovery.
     *
     * Queue: the context snapshot is dehydrated into every job payload via
     * Laravel Context and restored when the worker hydrates it — which also
     * republishes it to the database session. JobAttempted is dispatched from
     * a `finally` block in both the worker and the sync queue, so the reset
     * runs whether the job succeeded, threw or failed, and a reused worker
     * connection can never carry one tenant's context into the next job.
     *
     * Reconnection: a dropped connection comes back with an empty session.
     * Re-publishing on ConnectionEstablished stops a mid-request reconnect
     * from turning into a silently empty result set.
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

        Event::listen(JobAttempted::class, fn () => $this->app->make(TenantContext::class)->clear());

        Event::listen(function (ConnectionEstablished $event): void {
            $this->app->make(DatabaseTenantContext::class)->reapplyTo($event->connection);
        });
    }
}
