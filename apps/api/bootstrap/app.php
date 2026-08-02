<?php

declare(strict_types=1);

use Healthy360\AccessControl\Http\Middleware\RequirePermission;
use Healthy360\AccessControl\Http\Middleware\RequirePlatformContext;
use Healthy360\Identity\Http\Middleware\EnsureEmailIsVerified;
use Healthy360\Identity\Http\Middleware\EnsureStatefulRequest;
use Healthy360\Identity\Http\Middleware\RequireStepUp;
use Healthy360\Identity\Http\Middleware\TouchUserDevice;
use Healthy360\Support\Api\ApiExceptionRenderer;
use Healthy360\Support\Http\Middleware\AssignCorrelationId;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Healthy360\Tenancy\Http\Middleware\ResolveBranchContext;
use Healthy360\Tenancy\Http\Middleware\ResolveOrganisationContext;
use Healthy360\Tenancy\Http\Middleware\SetDatabaseTenantContext;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api-v1.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            // Fortify's own route registration is disabled
            // (FortifyServiceProvider): several stock responses are not
            // envelope-shaped and several routes need Healthy360 middleware.
            // The prefix and middleware stay config-driven so
            // config/fortify.php remains the single description of where
            // authentication lives.
            Route::middleware(config('fortify.middleware', ['api']))
                ->prefix(config('fortify.prefix', 'api/v1/auth'))
                ->group(base_path('routes/api-v1-auth.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Sanctum: cookie sessions for first-party origins, bearer tokens
        // for every other client.
        $middleware->statefulApi();
        $middleware->throttleApi();

        // Correlation runs outermost, so even a response produced by a
        // failing middleware leaves with X-Correlation-Id.
        $middleware->api(prepend: [AssignCorrelationId::class]);

        $middleware->alias([
            // db.context runs directly after auth:sanctum and publishes the
            // authenticated identity to the PostgreSQL session variables the
            // RLS policies read; org.context and branch.context reach the
            // same session automatically, because TenantContext republishes
            // itself whenever it changes.
            'db.context' => SetDatabaseTenantContext::class,
            'org.context' => ResolveOrganisationContext::class,
            'branch.context' => ResolveBranchContext::class,

            // Platform-operator surfaces: the selected organisation must be
            // the platform itself, on top of the platform permission.
            'platform.context' => RequirePlatformContext::class,

            'permission' => RequirePermission::class,
            'step-up' => RequireStepUp::class,

            // Optimistic concurrency: a write to a lock-versioned resource
            // must carry the version it was written against (428 without).
            'precondition' => RequirePrecondition::class,
            'stateful' => EnsureStatefulRequest::class,
            'device.touch' => TouchUserDevice::class,

            // Replaces Laravel's `verified` alias, which redirects browsers
            // to a view route and answers JSON callers with a bare 403 body.
            'verified' => EnsureEmailIsVerified::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // The single rendering path for every API failure: nothing reaches a
        // client outside the error envelope.
        $exceptions->render(
            fn (Throwable $e, Request $request) => app(ApiExceptionRenderer::class)->render($e, $request),
        );
    })->create();
