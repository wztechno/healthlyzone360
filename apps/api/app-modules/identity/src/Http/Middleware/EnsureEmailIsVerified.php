<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Middleware;

use Closure;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Replaces Laravel's `verified` middleware for the JSON API (alias:
 * verified).
 *
 * The framework default aborts with a bare 403 body and, for browser
 * requests, redirects to a view route that does not exist here. Email
 * verification is a separate concern from permission denial (plan §10), so it
 * carries its own code: 403 auth.email_unverified.
 */
class EnsureEmailIsVerified
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user === null) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        // A signed verification link may have updated the row while the
        // cookie session still holds the pre-verification model in memory.
        if ($user->email_verified_at === null) {
            $user->refresh();
        }

        if (! $user->hasVerifiedEmail()) {
            throw new ApiException(ErrorCode::AuthEmailUnverified);
        }

        return $next($request);
    }
}
