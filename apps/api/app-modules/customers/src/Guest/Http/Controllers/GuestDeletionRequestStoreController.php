<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use Healthy360\Customers\Guest\Http\Requests\RequestGuestDeletionRequest;
use Healthy360\Customers\Guest\Services\GuestDeletionService;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpChannel;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/guest/deletion-requests — anonymous.
 *
 * "Delete everything you hold about this address." Unauthenticated by
 * construction: the premise of a guest is that there is no account to sign into.
 *
 * ## Always `202`, always the same body
 *
 * There is no branch in this controller. `GuestDeletionAcknowledgement` is
 * built entirely from the submitted value and from configuration — not one
 * field is read from the database — so the response is byte-identical whether
 * the address is one we hold or one nobody has ever typed before, and
 * `GuestDeletionEnumerationTest` asserts that on the *whole* serialised result
 * rather than on chosen fields. The serialised shape is passed through
 * unaltered for exactly that reason: a key added here, however innocuous,
 * would be a key the property no longer covers.
 *
 * `202` rather than `200`, `201` or `404`, and every one of the alternatives
 * fails for the same reason. A `404` would say the address is unknown. A `201`
 * would say a challenge was created, which only happens for an address we hold.
 * A `200` would imply the work is done, and it is not — nothing is erased until
 * a passcode proves the requester holds the destination. `202` says precisely
 * what happened: the request was accepted, and what becomes of it is not this
 * response's business.
 *
 * ## The data is flat, not under a named key
 *
 * The house rule puts a single resource under a named key; this is not a
 * resource. It is an acknowledgement with no identifier, no `GET` and no
 * lifetime, and it takes the same flat shape `components/responses/Accepted`
 * already uses across the API.
 *
 * ## The refusal that is allowed
 *
 * `InvalidContactValue` — a value that is not an address or a number at all —
 * propagates and renders itself. It is a statement about the submitted string
 * and about nothing else, so it discloses nothing; and refusing it here is
 * better than accepting it, since a caller who typed `hello` into an erasure
 * form deserves to be told rather than reassured.
 *
 * ## The residual leak, stated rather than papered over
 *
 * A request for an address we hold also issues a challenge and queues a
 * message, so it takes measurably longer than one for an address we do not.
 * That is a **timing** oracle, it is real, and closing it means a constant-time
 * budget over the whole handler — a genuine HTTP-layer concern, deliberately
 * not faked here with a `usleep` that would be defeated by the first slow
 * query. It is left as a named seam: the honest position is a documented
 * residual rather than a mitigation that only looks like one.
 */
final class GuestDeletionRequestStoreController
{
    public function __construct(private readonly GuestDeletionService $deletions) {}

    /**
     * @throws ApiException
     */
    public function __invoke(RequestGuestDeletionRequest $request): JsonResponse
    {
        $payload = $request->payload();
        $deliveryChannel = $payload['delivery_channel'] ?? null;

        $acknowledgement = $this->deletions->request(
            channel: ContactChannel::from($payload['channel']),
            value: $payload['value'],
            deliveryChannel: is_string($deliveryChannel) ? OtpChannel::from($deliveryChannel) : null,
            // Deliberately not taken from `Accept-Language`. On an
            // unauthenticated surface the requester and the recipient are not
            // necessarily the same person: letting a stranger's browser choose
            // the language of a message sent to somebody else's mailbox is a
            // small harassment vector for no gain. `OtpService` resolves the
            // locale from the contact's own owner, which is the only party
            // whose preference is relevant.
            locale: null,
            requestIpHash: $this->digest($request->ip()),
        );

        return ApiResponse::data($acknowledgement->toArray(), status: 202);
    }

    /**
     * The requester's fingerprint for the OTP framework's abuse counters — a
     * digest, never the address itself.
     */
    private function digest(?string $value): ?string
    {
        return is_string($value) && $value !== '' ? hash('sha256', $value) : null;
    }
}
