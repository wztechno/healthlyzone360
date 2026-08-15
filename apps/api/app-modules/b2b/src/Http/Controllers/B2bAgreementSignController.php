<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\HandlesSignatureChallenges;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\SignAgreementRequest;
use Healthy360\B2b\Presenters\B2bAgreementPresenter;
use Healthy360\B2b\Services\AgreementService;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\SigningEvidence;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/b2b/applications/{application}/agreements/{agreement}/sign —
 * record that the signatory accepted these terms.
 *
 * ## The code is spent first, and the service still does not believe us
 *
 * This controller verifies the passcode, and then `AgreementService::sign()`
 * independently goes and looks for a **consumed** `b2b_signatory` challenge
 * belonging to the person signing. That is not a redundant check: the service
 * is reachable from a console command and a queued job as well as from here,
 * and a domain rule that depended on a controller having remembered to enforce
 * it is a rule that holds until somebody adds a second caller.
 * `SigningEvidence::$otpVerified` is therefore `false` on everything this
 * endpoint constructs — a caller cannot assert its own proof, and the service
 * overwrites the flag from what it observed.
 *
 * The challenge is looked up **by owner and by purpose before the code is
 * compared**, so a challenge belonging to somebody else, or raised for logging
 * in, is refused without spending one of three attempts. Otherwise anybody
 * could burn a signatory's allowance by pointing this endpoint at their
 * challenge. All of those refusals answer `403 b2b.signatory_required` with no
 * detail about which condition failed.
 *
 * ## What is recorded
 *
 * The digest of the exact bytes the signatory was shown, their typed name,
 * their stated capacity, the consent wording verbatim, and keyed digests of
 * the address and user agent the acceptance came from. The last two are hashed
 * because their job is corroboration — was this the same session as the rest
 * of the conversation — and a hash answers that without retaining anything.
 * They are taken from the request rather than accepted in the body: a
 * client-supplied corroboration is not corroboration.
 *
 * **This is not a qualified electronic signature** and no surface consuming
 * this response may describe it as one (master plan v2 Phase B1; INT-007
 * covers real e-sign).
 *
 * `200` rather than `201`: nothing was created. An existing agreement moved
 * from `pending_signature` to `active`, and the response carries its new
 * validator.
 */
final class B2bAgreementSignController
{
    use HandlesSignatureChallenges;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly AgreementService $agreements,
        private readonly OtpService $otp,
        private readonly B2bAgreementPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SignAgreementRequest $request, string $application, string $agreement): JsonResponse
    {
        $payload = $request->payload();

        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);
        $terms = $this->locator->agreement($record, $agreement);

        $challenge = $this->signatoryChallengeFor($actor, $payload['challenge_id']);
        $this->assertVerified($this->otp->verify($challenge, $payload['code']));

        $signed = $this->agreements->sign(
            $terms,
            new SigningEvidence(
                documentSha256: mb_strtolower($payload['document_sha256']),
                signatoryName: $payload['signatory_name'],
                signatoryTitle: $payload['signatory_title'],
                consentStatement: $payload['consent_statement'],
                ipHash: $this->requestIpHash($request),
                userAgentHash: $this->requestUserAgentHash($request),
                otpChallengeId: (string) $challenge->getKey(),
                // Never true here. The service proves it and says so.
                otpVerified: false,
            ),
            $actor,
        );

        return ApiResponse::data(['agreement' => $this->presenter->agreement($signed)])
            ->withHeaders(['ETag' => '"'.$signed->lock_version.'"']);
    }
}
