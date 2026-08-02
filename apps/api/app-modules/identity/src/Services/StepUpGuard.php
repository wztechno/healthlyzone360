<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use Healthy360\Identity\Models\PersonalAccessToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Date;

/**
 * Step-up state for sensitive actions (plan §13). A denial is HTTP 403 with
 * auth.step_up_required — never 423.
 *
 * The confirmation is bound to the credential that performed it, not to the
 * account: confirming in a browser must not silently unlock a sensitive
 * action for a phone holding a stolen token.
 *
 *  * A first-party session records it in the session, under the same
 *    `auth.password_confirmed_at` key Laravel's own password.confirm
 *    middleware reads, so the two can never disagree.
 *  * A bearer client has no session, so the confirmation is cached against
 *    the personal access token id under the same timeout.
 *
 * Either way it dies with the credential.
 *
 * ## Methods (J1)
 *
 * A step-up now says *how* it was performed. `password` is the original and is
 * unchanged in every respect — same session key, same three-hour
 * `auth.password_timeout`, same behaviour for the two routes already using it,
 * which is why those routes need no edit. `otp` is J1's addition, for the
 * actions where the question is not "does this person know the password" but
 * "is this person holding the phone": closure, payment details, a B2B
 * signature.
 *
 * The two are tracked separately and neither satisfies the other. A shared
 * flag would mean a password confirmation silently unlocking a passcode-gated
 * action, which would defeat the only reason to ask for a passcode at all.
 *
 * The OTP window is much shorter — ten minutes
 * (`verification.step_up.otp_ttl_seconds`) against three hours — because the
 * assurance it carries is about the present moment rather than about a secret
 * the person knows. A passcode confirmed at breakfast says nothing about who
 * is at the keyboard after lunch.
 *
 * Passcode confirmations are always cached, never written to the session, so
 * that one mechanism covers sessions and bearer tokens identically and the
 * shorter expiry is enforced by the cache rather than by arithmetic somebody
 * has to repeat.
 */
final class StepUpGuard
{
    public const string METHOD_PASSWORD = 'password';

    public const string METHOD_OTP = 'otp';

    private const string CACHE_PREFIX = 'h360:step-up:';

    private const string SESSION_KEY = 'auth.password_confirmed_at';

    public function confirmed(Request $request, string $method = self::METHOD_PASSWORD): bool
    {
        if ($method === self::METHOD_OTP) {
            return Cache::get($this->methodKey($request, self::METHOD_OTP)) === true;
        }

        $tokenId = $this->tokenId($request);

        if ($tokenId !== null) {
            return Cache::get(self::CACHE_PREFIX.'token:'.$tokenId) === true;
        }

        if ($request->hasSession()) {
            $confirmedAt = $request->session()->get(self::SESSION_KEY);

            return is_int($confirmedAt)
                && (Date::now()->unix() - $confirmedAt) < $this->timeoutSeconds();
        }

        return Cache::get($this->fallbackKey($request)) === true;
    }

    public function confirm(Request $request, string $method = self::METHOD_PASSWORD): void
    {
        if ($method === self::METHOD_OTP) {
            Cache::put($this->methodKey($request, self::METHOD_OTP), true, $this->timeoutSeconds(self::METHOD_OTP));

            return;
        }

        $tokenId = $this->tokenId($request);

        if ($tokenId !== null) {
            Cache::put(self::CACHE_PREFIX.'token:'.$tokenId, true, $this->timeoutSeconds());

            return;
        }

        if ($request->hasSession()) {
            $request->session()->put(self::SESSION_KEY, Date::now()->unix());

            return;
        }

        Cache::put($this->fallbackKey($request), true, $this->timeoutSeconds());
    }

    /**
     * Drop a confirmation. Used when the action it was granted for completes,
     * so a single step-up cannot be spent twice.
     */
    public function forget(Request $request, string $method = self::METHOD_PASSWORD): void
    {
        if ($method === self::METHOD_OTP) {
            Cache::forget($this->methodKey($request, self::METHOD_OTP));

            return;
        }

        $tokenId = $this->tokenId($request);

        if ($tokenId !== null) {
            Cache::forget(self::CACHE_PREFIX.'token:'.$tokenId);

            return;
        }

        if ($request->hasSession()) {
            $request->session()->forget(self::SESSION_KEY);

            return;
        }

        Cache::forget($this->fallbackKey($request));
    }

    public function timeoutSeconds(string $method = self::METHOD_PASSWORD): int
    {
        return $method === self::METHOD_OTP
            ? (int) config('verification.step_up.otp_ttl_seconds', 600)
            : (int) config('auth.password_timeout', 10800);
    }

    /**
     * The cache key for a method other than `password`, bound to the same
     * credential the password path binds to: the token if there is one, the
     * session identifier if there is not, and the account only when neither
     * exists.
     */
    private function methodKey(Request $request, string $method): string
    {
        $tokenId = $this->tokenId($request);

        if ($tokenId !== null) {
            return self::CACHE_PREFIX.$method.':token:'.$tokenId;
        }

        if ($request->hasSession()) {
            return self::CACHE_PREFIX.$method.':session:'.$request->session()->getId();
        }

        return self::CACHE_PREFIX.$method.':user:'.(string) $request->user()?->getAuthIdentifier();
    }

    private function tokenId(Request $request): ?string
    {
        $user = $request->user();
        $token = method_exists($user, 'currentAccessToken') ? $user->currentAccessToken() : null;

        return $token instanceof PersonalAccessToken ? (string) $token->getKey() : null;
    }

    /**
     * Neither a token nor a session: the credential cannot be pinned, so the
     * confirmation falls back to the account. Reachable only for guard-level
     * impersonation (console commands, tests), never for a real HTTP client.
     */
    private function fallbackKey(Request $request): string
    {
        return self::CACHE_PREFIX.'user:'.(string) $request->user()?->getAuthIdentifier();
    }
}
