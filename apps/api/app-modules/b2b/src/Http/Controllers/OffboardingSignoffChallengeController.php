<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\HandlesSignatureChallenges;
use Healthy360\B2b\Http\Concerns\ResolvesOffboarding;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/b2b/offboardings/{offboarding}/signoff-challenges —
 * send the signatory their passcode.
 *
 * **To the agreement's signatory, never to whoever is driving the wind-up.**
 * `OffboardingService::issueSignoffChallenge()` resolves the destination from
 * `b2b_agreements.signatory_user_id` through that person's login contact — the
 * one row that must agree with the login identity — so there is no question
 * which of somebody's addresses is meant and no way for an operator to nominate
 * one. The person who signed a company in is the person who signs it out; a
 * passcode the operator could redirect would be a formality.
 *
 * **That makes this endpoint different in kind from its B1 twin.**
 * `B2bAgreementSignatureChallengeController` sends the code to the
 * *authenticated caller's own* contact and refuses if they do not hold the
 * named address, because there the caller *is* the signatory. Here the caller is
 * a platform operator and the recipient is somebody else entirely — which is
 * why the response says only that a code was sent and where, in the masked form
 * `OtpService` authors. An operator learning the signatory's full address from
 * this response would learn it from a screen that has no reason to show it.
 *
 * `202`: a challenge is a message in flight, not a resource the caller may then
 * read. The same status the guest contact challenge uses, for the same reason.
 *
 * `offboarding.no_signatory_contact` is a `422` and a real state rather than a
 * defect: an agreement may name a signatory whose contact was retired, and the
 * answer is to amend the agreement rather than to invent a destination.
 */
final class OffboardingSignoffChallengeController
{
    use HandlesSignatureChallenges;
    use ResolvesOffboarding;

    public function __construct(private readonly OffboardingService $offboardings) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $offboarding): JsonResponse
    {
        $record = $this->offboarding($offboarding);

        $result = $this->offboardings->issueSignoffChallenge(
            $record,
            $request->getPreferredLanguage(),
            $this->requestIpHash($request),
        );

        // `OtpChallengeResult::toArray()`, the same body the B1 twin serves:
        // the shape a countdown, a masked destination and an attempts counter
        // are built from, authored by the module that owns those facts. The
        // masking in particular is server-authored — restating it here would be
        // a second implementation of a rule that already has one, on the
        // response most likely to be read by somebody other than the recipient.
        return ApiResponse::data(['challenge' => $result->toArray()], status: 202);
    }
}
