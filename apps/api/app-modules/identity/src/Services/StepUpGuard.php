<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use Healthy360\Identity\Models\PersonalAccessToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Date;

/**
 * Step-up (recent password confirmation) state for sensitive actions
 * (plan §13). A denial is HTTP 403 with auth.step_up_required — never 423.
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
 */
final class StepUpGuard
{
    private const string CACHE_PREFIX = 'h360:step-up:';

    private const string SESSION_KEY = 'auth.password_confirmed_at';

    public function confirmed(Request $request): bool
    {
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

    public function confirm(Request $request): void
    {
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

    public function timeoutSeconds(): int
    {
        return (int) config('auth.password_timeout', 10800);
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
