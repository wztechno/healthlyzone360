<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Http\Requests\VerifyChallengeRequest;
use Healthy360\Verification\Presenters\VerificationPresenter;
use Healthy360\Verification\Services\ContactVerificationService;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/verification/email/verify — the inline-OTP twin of the signed
 * link.
 *
 * The verification email carries both (D-036), and this is the half the native
 * client uses: a link opens a browser, and on iOS the round trip back into the
 * app loses the session often enough to be the most common place an onboarding
 * is abandoned. Six digits typed into the screen the person is already looking
 * at avoids the trip entirely, and both halves settle **the same two facts** —
 * the contact point is proven and `users.email_verified_at` is stamped — inside
 * one transaction, so the mirror can never disagree with the account.
 *
 * **Deliberately reachable before email verification**, for the same reason as
 * the challenge endpoint: a caller behind `verified` could never use it.
 *
 * No challenge identifier is asked for. The person is holding an email, not a
 * resource identifier, and there is at most one live `contact_verification`
 * challenge per contact — the partial unique index makes that structural — so
 * the server can find the only candidate itself. Asking a client to echo an
 * identifier it would have to have parsed out of a message is ceremony that
 * buys nothing.
 *
 * No live challenge is `otp.expired` rather than a 404: the challenge is a
 * transient credential, the caller has done nothing wrong, and the remedy —
 * ask for a new code — is exactly the one that code names.
 */
final class EmailVerifyController
{
    use HandlesOtpChallenges;

    public function __construct(
        private readonly OtpService $otp,
        private readonly ContactVerificationService $verification,
        private readonly ContactPointRegistry $contacts,
        private readonly VerificationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(VerifyChallengeRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $contact = $this->loginContact($user, $this->contacts);

        $challenge = $this->otp->liveChallengeFor($contact, OtpPurpose::ContactVerification);

        if ($challenge === null) {
            throw new ApiException(ErrorCode::OtpExpired);
        }

        $result = $this->verification->confirm($challenge, $request->payload()['code']);

        $this->assertVerified($result);

        return ApiResponse::data([
            'verified' => true,
            'contact' => $this->presenter->verifiedContact($contact->refresh(), $challenge),
        ]);
    }
}
