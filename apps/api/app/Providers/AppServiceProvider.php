<?php

declare(strict_types=1);

namespace App\Providers;

use Carbon\CarbonImmutable;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();
        $this->configureRateLimiting();
    }

    /**
     * The baseline limiter applied to every /api route by the `api`
     * middleware group. Authentication-specific limiters (login, two-factor,
     * forgot-password, verification) are narrower and live in
     * FortifyServiceProvider.
     *
     * `catalogue-import` has **no consumer yet**, and that is deliberate rather
     * than an oversight. The K1.8 importer is a CLI command
     * (`kitchen:import-greenlife`) run by an operator against a private source
     * tree; there is no import endpoint and this slice does not add one. The
     * definition lands now because the limiter is part of the K1 slice
     * inventory and because the alternative — introducing it in the same commit
     * as the endpoint it guards — is how a throttle ships untested and
     * unnoticed. A test pins its shape; the day an import route exists, it has
     * a limiter that somebody has already looked at.
     */
    protected function configureRateLimiting(): void
    {
        RateLimiter::for('api', fn (Request $request): Limit => Limit::perMinute(60)
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));

        RateLimiter::for('catalogue-import', fn (Request $request): Limit => Limit::perHour(5)
            ->by($this->importLimiterKey($request)));
    }

    /**
     * An import is an organisation-level act, so the bucket is the
     * organisation.
     *
     * Five imports an hour is not a defence against a hostile client — the
     * authentication and permission stack is — it is a defence against a
     * kitchen re-running a whole catalogue load in a loop because the first
     * attempt looked slow. The unit that must not do that is the tenant, not
     * the individual operator: two administrators of one kitchen taking five
     * runs each is exactly the thing being prevented.
     *
     * The fallbacks descend to what is knowable. A request that has not yet
     * resolved an organisation is keyed by user, and an unauthenticated one by
     * address — neither is the right bucket, but a limiter that returned an
     * empty key would put every such caller in one shared bucket, which is a
     * denial of service dressed as a throttle.
     */
    protected function importLimiterKey(Request $request): string
    {
        $organisationId = app(TenantContext::class)->organisationId();

        if ($organisationId !== null) {
            return 'organisation:'.$organisationId;
        }

        $userId = $request->user()?->getAuthIdentifier();

        return $userId === null
            ? 'ip:'.(string) $request->ip()
            : 'user:'.(string) $userId;
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
