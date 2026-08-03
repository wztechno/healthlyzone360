<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\HandlesSignatureChallenges;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Http\Requests\SignOffOffboardingRequest;
use Healthy360\B2b\Presenters\OffboardingPresenter;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\B2b\Services\OffboardingSignoff;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/signoff — the signatory
 * accepts.
 *
 * **The authenticated caller must be the signatory, and the check is inside the
 * service.** `OffboardingService::signOff()` demands a challenge that exists,
 * carries purpose `b2b_signatory`, has been *consumed*, and whose `user_id` is
 * the actor's. So an operator driving the wind-up cannot sign it off from their
 * own session — they hold no such challenge — and the route's
 * `b2b_offboarding.manage_platform` is necessary but nowhere near sufficient.
 * All four failures answer identically as `403 b2b.signatory_required`: a
 * caller holding somebody else's challenge identifier learns only that it did
 * not work.
 *
 * **The passcode is verified before this endpoint, not by it.** The challenge
 * must already be `verified` — spent through the generic
 * `POST /verification/challenges/{challenge}/verify` — which is the same
 * arrangement `AgreementService::sign()` uses and is deliberate: evidence a
 * caller asserts is not evidence, and a signing endpoint that also accepted the
 * code would be one round trip in which both the proof and the thing it proves
 * are claimed by the same request.
 *
 * `otp_verified` is **never** read from the body. `OffboardingSignoff` is
 * constructed with it false and becomes true only through `proved()`, which
 * only the service calls, after it has found the challenge.
 *
 * The two session hashes are computed here from what the connection carried,
 * keyed under the application key — a plain digest of an IPv4 address is a
 * thirty-two-bit search space and therefore not a hash at all. They are stored
 * and are deliberately **not** served back: see `OffboardingPresenter`.
 *
 * `settlement_outstanding` is checked before the evidence: a wind-up whose
 * settlement is neither cleared nor waived cannot be signed off, and the
 * refusal names every blocker at once so somebody sees the list rather than
 * discovering it.
 */
final class OffboardingSignoffController
{
    use HandlesSignatureChallenges;
    use ResolvesAuthenticatedUser;
    use ResolvesOffboarding;

    public function __construct(
        private readonly OffboardingService $offboardings,
        private readonly OffboardingPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SignOffOffboardingRequest $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);
        $actor = $this->currentUser($request);

        /** @var array{signatory_name: string, signatory_title: string, consent_statement: string, document_sha256?: string|null, otp_challenge_id: string} $payload */
        $payload = $request->validated();

        $signed = $this->offboardings->signOff(
            $record,
            new OffboardingSignoff(
                signatoryName: $payload['signatory_name'],
                signatoryTitle: $payload['signatory_title'],
                consentStatement: $payload['consent_statement'],
                documentSha256: $payload['document_sha256'] ?? null,
                ipHash: $this->requestIpHash($request),
                userAgentHash: $this->requestUserAgentHash($request),
                otpChallengeId: $payload['otp_challenge_id'],
                // Never from the body. `proved()` is the only way this becomes
                // true and only the service calls it.
            ),
            $actor,
        );

        return ApiResponse::data(['offboarding' => $this->presenter->offboarding($signed)])
            ->withHeaders(['ETag' => '"'.$signed->lock_version.'"']);
    }
}
