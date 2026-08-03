<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Services\ContactVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/verification/email/challenges — send me a code for my address.
 *
 * **Deliberately reachable before email verification**, and it is the one
 * endpoint for which that is not a concession but the whole point: a caller
 * behind `verified` could never ask for the code that makes them verified.
 *
 * There is no body. The destination is the caller's own login contact and is
 * read from the account rather than accepted from the request, because an
 * endpoint that took an address would issue codes to addresses the caller does
 * not hold — which is a way of sending mail on somebody else's behalf, and a
 * way of asking "does this address have an account here" one attempt at a time.
 *
 * 202 rather than 201: what has happened is that a message was handed to a
 * queue. The challenge row exists, but the thing the caller is waiting for —
 * an email — has not arrived yet, and saying "created" would invite a client to
 * believe otherwise.
 *
 * Refusals belong to the domain and render themselves: a cooldown, an exhausted
 * resend allowance and a locked-out contact are all `OtpIssueRefused`, and a
 * channel with no driver is `ChannelUnavailable`. Nothing is caught here.
 */
final class EmailChallengeStoreController
{
    use HandlesOtpChallenges;

    public function __construct(
        private readonly ContactVerificationService $verification,
        private readonly ContactPointRegistry $contacts,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $contact = $this->loginContact($user, $this->contacts);

        $result = $this->verification->start(
            contact: $contact,
            channel: OtpChannel::Email,
            requestIpHash: $this->requestIpHash($request),
        );

        return ApiResponse::data(['challenge' => $result->toArray()], status: 202);
    }
}
