<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Middleware;

use Closure;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves `X-Guest-Token` into a live guest session (alias `guest.session`).
 *
 * The capability-token counterpart to `auth:sanctum`: a guest has no account
 * to authenticate, so what they hold is an opaque bearer of a *capability*,
 * and the token is the whole credential. It is carried in its own header
 * rather than in `Authorization`, so that a client which happens to hold both
 * a personal access token and a guest token cannot silently send the wrong one
 * and cannot have the two confused by a proxy.
 *
 * ## One refusal, four causes
 *
 * Unknown, expired, revoked, and "live but not graded high enough" all answer
 * `401 guest.session_invalid` with nothing that distinguishes them. Telling a
 * caller *which* it was would tell a token-guesser that a guess had found a
 * real session — the distinction is only useful to somebody who does not
 * already hold the token, which is exactly who must not learn it.
 *
 * The grade gate is a middleware parameter (`guest.session:place_order`)
 * rather than a check inside each controller, so that "this endpoint needs a
 * verified contact" is visible in the routing table beside the path. The
 * default is `checkout_draft`: holding any live session at all.
 *
 * ## What it publishes
 *
 * The session and its customer account are put on the request attribute bag,
 * not on a container singleton. A middleware that mutated global state would
 * leak a guest identity into a queued job that runs after the response, and
 * the attribute bag dies with the request by construction. `EnforceIdempotency`
 * reads `guest_customer_account_id` from here, which is why it must run after
 * this middleware and not before.
 *
 * The token itself is never published. Nothing downstream needs it, and a
 * value on the request bag is a value that can end up in an exception report.
 */
final class ResolveGuestSession
{
    public const string ATTRIBUTE_SESSION = 'guest_session';

    public const string ATTRIBUTE_ACCOUNT_ID = 'guest_customer_account_id';

    public const string HEADER = 'X-Guest-Token';

    public function __construct(private readonly GuestSessionService $sessions) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next, string $grade = 'checkout_draft'): Response
    {
        $token = $request->header(self::HEADER);

        $session = is_string($token) && $token !== ''
            ? $this->sessions->resolve($token)
            : null;

        if (! $session instanceof GuestSession || ! $session->permits($this->grade($grade))) {
            throw new ApiException(ErrorCode::GuestSessionInvalid, details: ['required_grade' => $grade]);
        }

        $request->attributes->set(self::ATTRIBUTE_SESSION, $session);
        $request->attributes->set(self::ATTRIBUTE_ACCOUNT_ID, $session->customer_account_id);

        return $next($request);
    }

    /**
     * An unknown grade in a route declaration is a programming error, not a
     * client error — the same stance `RequirePermission` takes on an
     * unregistered permission code.
     */
    private function grade(string $grade): GuestSessionGrade
    {
        return GuestSessionGrade::tryFrom($grade)
            ?? throw new \InvalidArgumentException("[{$grade}] is not a guest session grade.");
    }
}
