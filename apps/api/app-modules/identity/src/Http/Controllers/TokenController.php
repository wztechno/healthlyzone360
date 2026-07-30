<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use App\Models\User;
use Healthy360\Identity\Http\Requests\IssueTokenRequest;
use Healthy360\Identity\Presenters\DevicePresenter;
use Healthy360\Identity\Services\DeviceRegistrar;
use Healthy360\Identity\Services\UserContextHydrator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Auth\Events\Failed;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Auth\Events\Login;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\LoginRateLimiter;

/**
 * POST /api/v1/auth/token — the native-client credential exchange (plan §13).
 *
 * A device name and platform are mandatory, because a token that cannot be
 * attributed to a device cannot be listed or revoked. The plaintext token is
 * returned exactly once, here; only its identifier is persisted, on the
 * device row.
 *
 * Throttling is shared with POST /api/v1/auth/login through Fortify's login
 * rate limiter (5 attempts per minute per email + IP), so a native client
 * cannot be used to sidestep the browser lockout.
 */
final class TokenController
{
    public function __construct(
        private readonly StatefulGuard $guard,
        private readonly LoginRateLimiter $limiter,
        private readonly TwoFactorAuthenticationProvider $twoFactor,
        private readonly DeviceRegistrar $devices,
        private readonly DevicePresenter $presenter,
        private readonly UserContextHydrator $hydrator,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(IssueTokenRequest $request): JsonResponse
    {
        if ($this->limiter->tooManyAttempts($request)) {
            event(new Lockout($request));

            throw new ApiException(ErrorCode::RateLimitExceeded);
        }

        $user = $this->authenticate($request);

        if ($user->hasEnabledTwoFactorAuthentication()) {
            $this->challengeTwoFactor($request, $user);
        }

        $this->limiter->clear($request);

        ['device' => $device, 'token' => $token] = $this->devices->register(
            $user,
            (string) $request->string('device_name'),
            (string) $request->string('platform'),
            $request->filled('app_version') ? (string) $request->string('app_version') : null,
        );

        event(new Login('sanctum', $user, false));

        return ApiResponse::data([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'user' => $this->hydrator->user($user),
            'device' => $this->presenter->device($device, (string) $token->accessToken->getKey()),
        ], status: 201);
    }

    /**
     * Credentials are validated through the guard's user provider rather
     * than by logging in: a native client must not receive a session cookie.
     *
     * @throws ApiException
     */
    private function authenticate(IssueTokenRequest $request): User
    {
        $email = Str::lower((string) $request->string('email'));
        $provider = $this->guard->getProvider();
        $candidate = $provider->retrieveByCredentials(['email' => $email]);

        if (! $candidate instanceof User
            || ! $provider->validateCredentials($candidate, ['password' => (string) $request->string('password')])) {
            event(new Failed('sanctum', $candidate, ['email' => $email]));

            $this->limiter->increment($request);

            throw new ApiException(ErrorCode::AuthInvalidCredentials);
        }

        return $candidate;
    }

    /**
     * A two-factor account must present a TOTP code or a recovery code in
     * the same request: there is no half-authenticated token state for
     * native clients to hold.
     *
     * @throws ApiException
     */
    private function challengeTwoFactor(IssueTokenRequest $request, User $user): void
    {
        $code = $request->filled('two_factor_code') ? (string) $request->string('two_factor_code') : null;
        $recoveryCode = $request->filled('recovery_code') ? (string) $request->string('recovery_code') : null;

        if ($code === null && $recoveryCode === null) {
            throw new ApiException(ErrorCode::AuthTwoFactorRequired);
        }

        if ($recoveryCode !== null) {
            $match = collect($user->recoveryCodes())
                ->first(static fn (string $stored): bool => hash_equals($stored, $recoveryCode));

            if (! is_string($match)) {
                $this->limiter->increment($request);

                throw new ApiException(ErrorCode::AuthTwoFactorInvalid, details: ['field' => 'recovery_code']);
            }

            $user->replaceRecoveryCode($match);

            return;
        }

        $secret = $user->two_factor_secret;

        // The secret is encrypted at rest by Fortify's own encrypter, not by
        // an Eloquent cast (see App\Models\User).
        if (! is_string($secret)
            || ! $this->twoFactor->verify(Fortify::currentEncrypter()->decrypt($secret), $code)) {
            $this->limiter->increment($request);

            throw new ApiException(ErrorCode::AuthTwoFactorInvalid, details: ['field' => 'two_factor_code']);
        }
    }
}
