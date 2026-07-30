<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Middleware;

use Closure;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the cookie-session endpoints (alias: stateful).
 *
 * Sanctum only starts a session for requests whose Origin or Referer matches
 * a configured stateful domain. Without one, login would "succeed" while
 * issuing no session cookie, and the client would be silently unauthenticated
 * on its next call. Native clients must use POST /api/v1/auth/token instead,
 * so this returns an actionable 400 rather than letting a session-less
 * request fall over inside Fortify.
 */
class EnsureStatefulRequest
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->hasSession()) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'This endpoint serves first-party session clients only; native clients must use /api/v1/auth/token.',
                ['required_headers' => ['Origin']],
            );
        }

        return $next($request);
    }
}
