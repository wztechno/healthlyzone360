<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Http\Requests\VerifyChallengeRequest;
use Healthy360\Verification\Presenters\VerificationPresenter;
use Healthy360\Verification\Services\ContactVerificationService;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/verification/challenges/{challenge}/verify — spend a code.
 *
 * Confirmed through `ContactVerificationService` rather than `OtpService`,
 * because this endpoint is about what a right code *means*: the destination is
 * marked proven, and when it is the login mirror `users.email_verified_at` is
 * settled in the same transaction. `OtpService` alone would check the digits
 * and leave the account exactly as unverified as it was.
 *
 * The response says `verified: true` and nothing else could reach it — every
 * other outcome has already been thrown. A wrong code is `otp.invalid` carrying
 * `attempts_remaining`, an exhausted challenge is `otp.attempts_exceeded`, an
 * expired or superseded one is `otp.expired`, and a locked contact is
 * `otp.locked` with the moment it lifts. That mapping is the one translation
 * this module's HTTP layer performs; see `HandlesOtpChallenges`.
 *
 * The contact is re-read after the confirmation rather than reused, so
 * `verified_at` on the wire is the committed value and not the one this request
 * happened to be holding.
 */
final class ChallengeVerifyController
{
    use HandlesOtpChallenges;

    public function __construct(
        private readonly ContactVerificationService $verification,
        private readonly VerificationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(VerifyChallengeRequest $request, string $challenge): JsonResponse
    {
        $user = $this->currentUser($request);
        $record = $this->challengeFor($user, $challenge);

        $result = $this->verification->confirm($record, $request->payload()['code']);

        $this->assertVerified($result);

        $contact = $record->contactPoint()->first();

        return ApiResponse::data([
            'verified' => true,
            'contact' => $contact instanceof ContactPoint
                ? $this->presenter->verifiedContact($contact, $record)
                : null,
        ]);
    }
}
