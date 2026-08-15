<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use Healthy360\Customers\Guest\Http\Middleware\ResolveGuestSession;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Presenters\GuestSessionPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/guest/session — `guest.session`.
 *
 * "What am I allowed to do, and how long have I got?" The endpoint a client
 * calls on resume, when a token has been sitting in local storage since
 * yesterday and the only honest way to find out whether it still works is to
 * use it.
 *
 * ## Its refusal is its most useful answer
 *
 * A dead token gets `401 guest.session_invalid` from the middleware, which is
 * exactly what the client needs in order to start a new session and say so. It
 * is deliberately not a `200` carrying `{live: false}`: a body that described a
 * session the caller may not use would mean every consumer had to branch twice,
 * and the second branch is the one people forget.
 *
 * ## Never the token
 *
 * The response has no `token` key. The caller already holds it — that is how
 * they reached here — so echoing it buys nothing and puts a credential into a
 * response that a client may cache, log or screenshot. `GuestSessionPresenter`
 * has no method that could return one.
 *
 * ## Note for the anonymous-surface sweep
 *
 * This route is a `GET` under `/api/v1` that does not carry `auth:sanctum`, so
 * `PublicSurfaceLeakSweepTest` discovers it as part of the anonymous surface.
 * That is a false positive with a true half: the endpoint is *credentialled*
 * by `X-Guest-Token` rather than anonymous, but an anonymous caller can reach
 * it and will be refused, and a refusal envelope is a perfectly good place to
 * leak. Swept without a header it answers `401` and carries nothing but the
 * error envelope, which is the right thing for the sweep to assert.
 */
final class GuestSessionShowController
{
    public function __construct(private readonly GuestSessionPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        // Published by `guest.session`, which has already refused everything
        // that is not a live session of at least the required grade. Re-checking
        // here would give two answers to one question, and the second would
        // eventually disagree with the routing table.
        /** @var GuestSession $session */
        $session = $request->attributes->get(ResolveGuestSession::ATTRIBUTE_SESSION);

        return ApiResponse::data([
            'session' => $this->presenter->session($session),
            'customer_account' => $this->presenter->account($session->customerAccount),
        ]);
    }
}
