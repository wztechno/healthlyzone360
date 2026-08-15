<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Http\Requests\ResendChallengeRequest;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/verification/challenges/{challenge}/resend — send it again.
 *
 * Routed through `OtpService` rather than `ContactVerificationService`, which
 * is the opposite choice from the verify endpoint next door and deliberately
 * so: one challenge in this table may be a contact verification, a closure
 * step-up or a B2B signature, and resending is the same act for all three.
 * Verifying is not — that is where the meaning diverges, and that is where the
 * more specific service earns its place.
 *
 * The code is regenerated rather than resent, because only its digest is kept.
 * The attempt counter and the expiry window carry over, so nobody buys three
 * fresh attempts by pressing the button; the cooldown, the resend allowance and
 * the lockout are all enforced by the service and arrive as domain refusals
 * that render themselves.
 *
 * 202, like the issue: what happened is that a message was queued.
 */
final class ChallengeResendController
{
    use HandlesOtpChallenges;

    public function __construct(private readonly OtpService $otp) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ResendChallengeRequest $request, string $challenge): JsonResponse
    {
        $user = $this->currentUser($request);
        $record = $this->challengeFor($user, $challenge);

        $channel = $request->payload()['channel'] ?? null;

        $result = $this->otp->resend(
            challenge: $record,
            channel: $channel === null ? null : OtpChannel::from($channel),
        );

        return ApiResponse::data(['challenge' => $result->toArray()], status: 202);
    }
}
