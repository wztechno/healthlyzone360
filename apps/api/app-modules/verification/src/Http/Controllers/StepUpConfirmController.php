<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use Healthy360\Identity\Services\StepUpGuard;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Http\Requests\ConfirmStepUpRequest;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/verification/step-up/confirm — spend the passcode, unlock the
 * action.
 *
 * The purpose is checked **before** the code is compared, and the ordering is
 * the security property: verifying first would spend one of three attempts on a
 * challenge that was never going to be honoured, so an attacker could burn a
 * victim's allowance by pointing this endpoint at their contact-verification
 * challenge. Refusing on the purpose costs nothing and burns nothing.
 *
 * That refusal is `validation.failed` on `challenge_id`. It is a body field
 * naming a row whose purpose is wrong, which is a malformed submission rather
 * than a permission problem — and reporting it as a denial would suggest that
 * some other caller might be allowed to replay a contact-verification code
 * against a payment change. Nobody is.
 *
 * Confirmed through `OtpService`, never `ContactVerificationService`: a step-up
 * proves presence and must not, as a side effect, mark a destination proven.
 * Those are separate facts with separate consequences, and folding them
 * together would let a closure step-up quietly satisfy an activation
 * requirement.
 *
 * The grant is bound to the calling credential — the personal access token, or
 * the session when there is none — so confirming in a browser cannot unlock a
 * sensitive action for a phone holding a stolen token. `expires_in_seconds` is
 * the guard's own timeout rather than a number restated here, because a client
 * that had to guess when its step-up lapsed would guess wrong.
 */
final class StepUpConfirmController
{
    use HandlesOtpChallenges;

    public function __construct(
        private readonly OtpService $otp,
        private readonly StepUpGuard $stepUp,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ConfirmStepUpRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $user = $this->currentUser($request);
        $challenge = $this->challengeFor($user, $payload['challenge_id']);

        if (! $challenge->purpose->grantsStepUp()) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That challenge was not issued for a step-up.',
                ['fields' => ['challenge_id' => ['That challenge was not issued for a step-up.']]],
            );
        }

        $this->assertVerified($this->otp->verify($challenge, $payload['code']));

        $this->stepUp->confirm($request, StepUpGuard::METHOD_OTP);

        return ApiResponse::data([
            'confirmed' => true,
            'method' => StepUpGuard::METHOD_OTP,
            'expires_in_seconds' => $this->stepUp->timeoutSeconds(StepUpGuard::METHOD_OTP),
        ]);
    }
}
