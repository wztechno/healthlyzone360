<?php

declare(strict_types=1);

namespace App\Providers;

use Carbon\CarbonImmutable;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Symfony\Component\Mailer\Bridge\Brevo\Transport\BrevoTransportFactory;
use Symfony\Component\Mailer\Transport\Dsn;
use Symfony\Component\Mailer\Transport\TransportInterface;

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
        $this->configureBrevoMailTransport();
    }

    /**
     * Symfony Brevo API transport (docs: Laravel mail — third-party transports).
     *
     * Bearer-token Expo clients never use cookie sessions; the same is true of
     * mail: verification and OTP notifications are sent from this API via
     * Laravel Mail, not from the Expo app. `symfony/brevo-mailer` registers
     * here rather than via `@getbrevo/brevo`, which is the Node SDK.
     */
    private function configureBrevoMailTransport(): void
    {
        Mail::extend('brevo', function (): TransportInterface {
            $key = (string) config('services.brevo.key');

            return (new BrevoTransportFactory)->create(
                new Dsn('brevo+api', 'default', $key === '' ? null : $key),
            );
        });
    }

    /**
     * The baseline limiter applied to every /api route by the `api`
     * middleware group. Authentication-specific limiters (login, two-factor,
     * forgot-password, verification) are narrower and live in
     * FortifyServiceProvider.
     *
     * `catalogue-import` guards the three workbook imports —
     * `POST /catalogue/ingredients/imports`, `/catalogue/recipes/imports` and
     * `/catalogue/inventory/counts/imports` — bucketed by organisation. Thirty
     * an hour, not five: a kitchen fixing a typo and re-uploading spends a
     * run each time, and five ran out after three such loops. Thirty is still
     * a loop guard (at most ~30k row writes per organisation per hour), not
     * friction; authentication and permissions are the defence, not this.
     */
    protected function configureRateLimiting(): void
    {
        RateLimiter::for('api', fn (Request $request): Limit => Limit::perMinute(config('api.rate_limit'))
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));

        RateLimiter::for('catalogue-import', fn (Request $request): Limit => Limit::perHour(30)
            ->by($this->importLimiterKey($request)));

        // Each call spends a model request; a form fires one per new name, so this only bites a loop.
        RateLimiter::for('ingredient-assist', fn (Request $request): Limit => Limit::perMinute(20)
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));

        /*
         * The token-scoped invitation read (`GET /api/v1/invitations/{token}`).
         *
         * Anonymous, so the bucket can only be the address — there is no
         * identity to key on, which is exactly the condition this limiter
         * exists for. Twenty a minute rather than the `api` group's sixty: the
         * endpoint answers "yes, that token names a real invitation", and a
         * wrong answer is still an answer, so it is the one anonymous read
         * where the rate matters more than the convenience.
         *
         * Twenty is chosen to be invisible to a person and useless to a
         * search. A human clicks one link, occasionally reloads it, and may
         * hold two invitations at once; a 256-bit token space is not reachable
         * at any rate this side of the heat death of the universe, so the
         * limiter is a floor under an already-safe design rather than the
         * defence itself.
         */
        RateLimiter::for('invitation-lookup', fn (Request $request): Limit => Limit::perMinute(20)
            ->by((string) $request->ip()));

        /*
         * The anonymous guest flow. A session is free to open, and each
         * passcode request supersedes the last and sends a fresh message, so
         * without these a loop could flood one inbox or phone at the `api`
         * group's sixty a minute. The destination bucket is what protects the
         * recipient: rotating IP addresses does not reset it.
         */
        RateLimiter::for('guest-session', fn (Request $request): Limit => Limit::perMinute(20)
            ->by((string) $request->ip()));

        RateLimiter::for('guest-passcode', fn (Request $request): array => [
            Limit::perMinute(10)->by('ip:'.$request->ip()),
            Limit::perHour(5)->by('to:'.Str::lower(trim((string) $request->input('value')))),
        ]);
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
