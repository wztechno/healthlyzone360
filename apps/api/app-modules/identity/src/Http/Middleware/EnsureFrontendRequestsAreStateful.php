<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Middleware;

use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful as SanctumEnsureFrontendRequestsAreStateful;

/**
 * Sanctum's stateful-domain gate, adjusted for Healthy360's two credential paths.
 *
 * Sanctum treats any request whose Origin or Referer matches
 * `SANCTUM_STATEFUL_DOMAINS` as a first-party SPA and applies the session stack
 * (StartSession, CSRF verification). That is correct for the cookie-session
 * endpoints guarded by `stateful` — login, logout, two-factor-challenge.
 *
 * The Expo clients are different: web, iOS and Android all identify themselves
 * with `X-Client-Platform` and authenticate with bearer tokens via
 * `POST /api/v1/auth/token`, using `credentials: 'omit'` so no session cookie is
 * ever attached. The browser still sends Origin on cross-origin fetches, which
 * would otherwise trigger CSRF verification the client cannot satisfy and map,
 * on the wire, to `auth.csrf_token_mismatch`.
 *
 * When `X-Client-Platform` is present the request is a bearer client, not a
 * cookie-session SPA, and Sanctum's frontend middleware must not run.
 */
class EnsureFrontendRequestsAreStateful extends SanctumEnsureFrontendRequestsAreStateful
{
    /**
     * @param  Request  $request
     */
    public static function fromFrontend($request): bool
    {
        if ($request->headers->has('X-Client-Platform')) {
            return false;
        }

        return parent::fromFrontend($request);
    }
}
