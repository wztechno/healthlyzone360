<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use Healthy360\Customers\Guest\Http\Requests\StartGuestSessionRequest;
use Healthy360\Customers\Guest\Presenters\GuestSessionPresenter;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Random\RandomException;

/**
 * POST /api/v1/guest/sessions — anonymous.
 *
 * The one endpoint in the platform that hands a caller a credential without
 * asking for one first, and the only response anywhere that carries a
 * plaintext guest token.
 *
 * ## The token exists once
 *
 * `GuestSessionService::start()` mints it, stores a digest, and puts the
 * plaintext on the returned object. This response is where it goes and there is
 * nowhere else it can go afterwards: `GET /guest/session` has no `token` key,
 * the model has no attribute for it, and nothing re-derives it from the digest.
 * A client that loses it has lost the basket, which is the correct outcome — the
 * alternative is a "recover my guest session" surface, and the only credential
 * it could authenticate against is the one that was lost.
 *
 * For the same reason nothing here logs the response and nothing puts the token
 * on the request attribute bag. A value on the bag is a value an exception
 * reporter will happily serialise into a bug tracker.
 *
 * ## The fingerprints are taken, never accepted
 *
 * `ip_hash` and `user_agent_hash` are hashed **in this controller** from what
 * the connection actually carried, because that is where the connection is. The
 * service takes digests and never sees a raw address — a module that stored a
 * raw IP would have quietly turned an anonymous journey into a tracked one — and
 * the request body has no field for either, since a caller who could choose
 * their own fingerprint does not have one.
 *
 * `sha256` unsalted and unpeppered, matching `GuestSessionTokens`: these are
 * correlation keys for an abuse investigation, not secrets, and a per-instance
 * salt would make two records of the same browser incomparable, which is the
 * only thing they are for.
 *
 * ## No idempotency
 *
 * `Idempotency-Key` is not read and the route does not carry the middleware. A
 * replayed session start would have to return the *original token*, which
 * cannot be done — it is not stored — and any other answer would be a second
 * credential wearing the first one's key. Opening two guest sessions costs two
 * rows and no obligation to anybody, which is the cheapest kind of duplicate
 * there is.
 */
final class GuestSessionStoreController
{
    public function __construct(
        private readonly GuestSessionService $sessions,
        private readonly GuestSessionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     * @throws RandomException when the platform has no usable source of entropy
     */
    public function __invoke(StartGuestSessionRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $started = $this->sessions->start(
            ipHash: $this->digest($request->ip()),
            userAgentHash: $this->digest($request->userAgent()),
            preferredLanguageCode: $payload['preferred_language_code'] ?? null,
            countryCode: $payload['country_code'] ?? null,
        );

        return ApiResponse::data($this->presenter->started($started), status: 201);
    }

    /**
     * A fingerprint, or nothing at all.
     *
     * The empty string is mapped to `null` rather than hashed: every caller
     * behind a proxy that strips the header would otherwise share one
     * fingerprint, and a column full of the digest of `''` looks like evidence
     * while being the opposite.
     */
    private function digest(?string $value): ?string
    {
        return is_string($value) && $value !== '' ? hash('sha256', $value) : null;
    }
}
