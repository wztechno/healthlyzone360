<?php

declare(strict_types=1);

namespace App\Providers;

use App\Actions\Fortify\AttemptToAuthenticate;
use App\Actions\Fortify\ChallengeTwoFactorAuthenticatable;
use App\Actions\Fortify\CreateNewUser;
use App\Actions\Fortify\ResetUserPassword;
use App\Http\Responses\EmailVerificationNotificationSentResponse;
use App\Http\Responses\FailedPasswordResetLinkRequestResponse;
use App\Http\Responses\FailedPasswordResetResponse;
use App\Http\Responses\FailedTwoFactorLoginResponse;
use App\Http\Responses\LockoutResponse;
use App\Http\Responses\LoginResponse;
use App\Http\Responses\LogoutResponse;
use App\Http\Responses\PasswordResetResponse;
use App\Http\Responses\RegisterResponse;
use App\Http\Responses\SuccessfulPasswordResetLinkRequestResponse;
use App\Http\Responses\TwoFactorLoginResponse;
use App\Http\Responses\VerifyEmailResponse;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Laravel\Fortify\Actions\CanonicalizeUsername;
use Laravel\Fortify\Actions\EnsureLoginIsNotThrottled;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Contracts\EmailVerificationNotificationSentResponse as EmailVerificationNotificationSentResponseContract;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse as FailedPasswordResetLinkRequestResponseContract;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse as FailedPasswordResetResponseContract;
use Laravel\Fortify\Contracts\FailedTwoFactorLoginResponse as FailedTwoFactorLoginResponseContract;
use Laravel\Fortify\Contracts\LockoutResponse as LockoutResponseContract;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;
use Laravel\Fortify\Contracts\LogoutResponse as LogoutResponseContract;
use Laravel\Fortify\Contracts\PasswordResetResponse as PasswordResetResponseContract;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse as SuccessfulPasswordResetLinkRequestResponseContract;
use Laravel\Fortify\Contracts\TwoFactorLoginResponse as TwoFactorLoginResponseContract;
use Laravel\Fortify\Contracts\VerifyEmailResponse as VerifyEmailResponseContract;
use Laravel\Fortify\Fortify;

/**
 * Fortify, headless (plan §13).
 *
 * Every response Fortify can produce is rebound to a class in
 * app/Http/Responses that speaks the Healthy360 envelope — no redirects, no
 * views, no Inertia. Route registration is handed to routes/api-v1-auth.php
 * so that paths, middleware, and the few endpoints Fortify cannot serve in
 * the envelope, are all declared in one readable place.
 */
class FortifyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        Fortify::ignoreRoutes();
    }

    public function boot(): void
    {
        $this->configureResponses();
        $this->configureActions();
        $this->configureLoginPipeline();
        $this->configureRateLimiting();
        $this->configurePasswordResetLinks();
    }

    /**
     * JSON replacements for every Fortify response the API can reach.
     * Contracts left unbound belong to features Healthy360 does not expose
     * (profile-information updates, password updates, passkeys).
     */
    private function configureResponses(): void
    {
        $this->app->singleton(LoginResponseContract::class, LoginResponse::class);
        $this->app->singleton(LogoutResponseContract::class, LogoutResponse::class);
        $this->app->singleton(LockoutResponseContract::class, LockoutResponse::class);
        $this->app->singleton(RegisterResponseContract::class, RegisterResponse::class);
        $this->app->singleton(VerifyEmailResponseContract::class, VerifyEmailResponse::class);
        $this->app->singleton(EmailVerificationNotificationSentResponseContract::class, EmailVerificationNotificationSentResponse::class);
        $this->app->singleton(SuccessfulPasswordResetLinkRequestResponseContract::class, SuccessfulPasswordResetLinkRequestResponse::class);
        $this->app->singleton(FailedPasswordResetLinkRequestResponseContract::class, FailedPasswordResetLinkRequestResponse::class);
        $this->app->singleton(PasswordResetResponseContract::class, PasswordResetResponse::class);
        $this->app->singleton(FailedPasswordResetResponseContract::class, FailedPasswordResetResponse::class);
        $this->app->singleton(TwoFactorLoginResponseContract::class, TwoFactorLoginResponse::class);
        $this->app->singleton(FailedTwoFactorLoginResponseContract::class, FailedTwoFactorLoginResponse::class);
    }

    private function configureActions(): void
    {
        Fortify::createUsersUsing(CreateNewUser::class);
        Fortify::resetUserPasswordsUsing(ResetUserPassword::class);
    }

    /**
     * The login pipeline, declared rather than inferred.
     *
     * EnsureLoginIsNotThrottled stays first so that a lockout raises
     * Illuminate\Auth\Events\Lockout (audited) and answers with the
     * rate-limit envelope. The two-factor and credential stages are the
     * Healthy360 subclasses, which report a rejected attempt as
     * auth.invalid_credentials rather than a field-level validation error.
     */
    private function configureLoginPipeline(): void
    {
        Fortify::authenticateThrough(fn (): array => [
            EnsureLoginIsNotThrottled::class,
            CanonicalizeUsername::class,
            ChallengeTwoFactorAuthenticatable::class,
            AttemptToAuthenticate::class,
            PrepareAuthenticatedSession::class,
        ]);
    }

    /**
     * Named limiters used by routes/api-v1-auth.php. Login itself is limited
     * inside the pipeline (see config/fortify.php) at five attempts per
     * minute per email and IP address, which POST /api/v1/auth/token shares.
     */
    private function configureRateLimiting(): void
    {
        RateLimiter::for('two-factor', fn (Request $request): Limit => Limit::perMinute(5)
            ->by((string) $request->session()->get('login.id', (string) $request->ip())));

        // Keyed by email alone: a reset link is sent to an address, so
        // rotating IP addresses must not multiply the mail a person receives.
        RateLimiter::for('forgot-password', fn (Request $request): Limit => Limit::perMinute(3)
            ->by(Str::transliterate(Str::lower((string) $request->input(Fortify::username())))));

        RateLimiter::for('verification', fn (Request $request): Limit => Limit::perMinute(6)
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));
    }

    /**
     * The reset link must open the client application: there is no
     * server-rendered reset form. The token and email travel as query
     * parameters, which the client posts back to
     * POST /api/v1/auth/reset-password.
     */
    private function configurePasswordResetLinks(): void
    {
        ResetPassword::createUrlUsing(static fn (User $user, string $token): string => sprintf(
            '%s/auth/reset-password?token=%s&email=%s',
            rtrim((string) config('app.frontend_url'), '/'),
            $token,
            urlencode($user->getEmailForPasswordReset()),
        ));
    }
}
