<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Http\Controllers;

use Healthy360\Customers\Guest\Http\Middleware\ResolveGuestSession;
use Healthy360\Customers\Guest\Http\Requests\StoreGuestContactRequest;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpChannel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/guest/contacts — `guest.session`.
 *
 * A guest supplies somewhere we can reach them, and we send a passcode to it.
 * The first half of the only act that raises a session's grade: `place_order`
 * exists because an order is a promise that somebody will be told when it is
 * late, and a destination nobody proved is a promise made to a typo.
 *
 * ## Why this is a `202` and not a `201`
 *
 * Nothing durable is created that the caller may then read. A challenge row
 * exists, but it is a message in flight — it expires in minutes, it has no
 * `GET`, and the caller cannot do anything with it except answer it. `202
 * Accepted` says what actually happened: the request was taken, and delivery is
 * somebody else's problem now. The channel is a queued job; a `201` would be
 * claiming a message was delivered by a driver that has not run yet.
 *
 * ## The response says a challenge exists, and that is safe here
 *
 * Unlike the erasure surface, this endpoint may be candid. The caller holds a
 * live guest token and typed the destination themselves, so `destination_masked`,
 * `attempts_remaining` and the resend countdown tell them nothing they did not
 * bring with them. `OtpChallengeResult::toArray()` is already that shape and is
 * used unaltered — a presenter here would be a second description of one screen,
 * and the two would drift.
 *
 * ## The refusals are the domain's, unmapped
 *
 * `InvalidContactValue`, `OtpIssueRefused` and `ChannelUnavailable` all render
 * themselves through `ProvidesApiError`. Catching them here to choose a status
 * would put the vocabulary in two places and would eventually contradict the
 * module that owns the refusal.
 */
final class GuestContactStoreController
{
    public function __construct(private readonly GuestSessionService $sessions) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreGuestContactRequest $request): JsonResponse
    {
        /** @var GuestSession $session */
        $session = $request->attributes->get(ResolveGuestSession::ATTRIBUTE_SESSION);

        $payload = $request->payload();
        $deliveryChannel = $payload['delivery_channel'] ?? null;

        $result = $this->sessions->requestContactVerification(
            session: $session,
            channel: ContactChannel::from($payload['channel']),
            value: $payload['value'],
            deliveryChannel: is_string($deliveryChannel) ? OtpChannel::from($deliveryChannel) : null,
            locale: $this->locale($request),
            requestIpHash: $this->digest($request->ip()),
        );

        return ApiResponse::data(['challenge' => $result->challenge->toArray()], status: 202);
    }

    /**
     * The language of the message, taken from the request rather than the row.
     *
     * `Accept-Language` is what the person is reading *right now*: a guest who
     * switched the app to Arabic between filling the basket and asking for a
     * code should get an Arabic code, and the account's stored preference was
     * captured when the session opened and may be older than that.
     *
     * `null` is not a default — it is a deferral. `OtpService::localeFor()`
     * already knows how to ask the contact's owner, and duplicating that
     * fallback here would create a second answer to the same question.
     */
    private function locale(Request $request): ?string
    {
        $header = $request->header('Accept-Language');

        if (! is_string($header) || $header === '') {
            return null;
        }

        $primary = strtolower(substr(trim(explode(',', $header)[0]), 0, 2));

        return preg_match('/^[a-z]{2}$/', $primary) === 1 ? $primary : null;
    }

    /**
     * The requester's fingerprint for the OTP framework's own abuse counters —
     * a digest, never the address, for the reason `GuestSessionStoreController`
     * states at length.
     */
    private function digest(?string $value): ?string
    {
        return is_string($value) && $value !== '' ? hash('sha256', $value) : null;
    }
}
