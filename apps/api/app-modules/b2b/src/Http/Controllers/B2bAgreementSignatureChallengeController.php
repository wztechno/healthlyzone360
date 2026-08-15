<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use App\Models\User;
use Healthy360\B2b\Http\Concerns\HandlesSignatureChallenges;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Identity\Services\ContactValueNormaliser;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST
 * /api/v1/b2b/applications/{application}/agreements/{agreement}/signature-challenges
 * — send the named signatory a passcode.
 *
 * ## The question this endpoint answers
 *
 * Not "may this person sign?" but "**is this person the one the company said
 * would sign?**" Those are different questions and only the second one is
 * answerable from the data. The application's `signatory_email` is a
 * declaration the company made and a reviewer checked against an identity
 * document; the authenticated caller is whoever is holding the session. The
 * endpoint issues a passcode only when the two are the same address.
 *
 * ## Three steps, and the order matters
 *
 * 1. **Record the named address as an application-owned contact point.**
 *    `ContactPointRegistry::rememberForApplication()` is the widened owner kind
 *    that exists for exactly this: the signatory a company names may have no
 *    relationship with the platform at all, so the application is the only
 *    thing that can own the destination. Recording it makes the declaration
 *    normalised, hashed and auditable — evidence of *who was named*, kept
 *    whether or not they ever sign — and it is done before the ownership check
 *    so the evidence survives a refusal.
 * 2. **Require the caller to hold that same address themselves.** The
 *    comparison is between normalised values on both sides, through
 *    `ContactValueNormaliser`, because `Ali@Example.COM ` and
 *    `ali@example.com` are one address and a raw string comparison would say
 *    otherwise. Failing this is `403 b2b.signatory_required`: the named
 *    signatory has to sign in and sign for themselves, and an office manager
 *    who can reach the mailbox is not the person the company bound itself
 *    through.
 * 3. **Issue the challenge against the caller's own contact point**, never
 *    against the application-owned one. `otp_challenges.user_id` is filled
 *    from the contact's owner, and `AgreementService::sign()` demands a
 *    consumed challenge whose subject *is* the person signing. A challenge
 *    raised against an ownerless application contact would carry no user and
 *    could never satisfy that check — the signature would be unprovable, which
 *    is the failure the whole arrangement exists to prevent.
 *
 * The caller's contact does **not** have to be verified already. The passcode
 * is what proves control of the address; demanding prior proof would be
 * demanding the thing being established.
 *
 * `202`, not `201`: a challenge has been raised and a message dispatched, and
 * whether it arrives is the channel's business. The body is
 * `OtpChallengeResult::toArray()` — the shape a countdown, a masked
 * destination and an attempts counter are built from, authored by the module
 * that owns those facts rather than restated here.
 */
final class B2bAgreementSignatureChallengeController
{
    use HandlesSignatureChallenges;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly ContactPointRegistry $contacts,
        private readonly ContactValueNormaliser $normaliser,
        private readonly OtpService $otp,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $application, string $agreement): JsonResponse
    {
        $actor = $this->currentUser($request);
        $record = $this->locator->ownApplication($application, $actor);
        $this->locator->agreement($record, $agreement);

        $named = $this->namedSignatoryAddress($record);

        $this->contacts->rememberForApplication(
            applicationId: (string) $record->getKey(),
            channel: ContactChannel::Email,
            value: $named,
            source: 'self_service',
            label: 'signatory',
            createdBy: (string) $actor->getKey(),
        );

        $result = $this->otp->issue(
            contact: $this->actorContactFor($actor, $named),
            purpose: OtpPurpose::B2bSignatory,
            requestIpHash: $this->requestIpHash($request),
        );

        return ApiResponse::data(['challenge' => $result->toArray()], status: 202);
    }

    /**
     * @throws ApiException
     */
    private function namedSignatoryAddress(B2bApplication $application): string
    {
        $named = $application->signatory_email;

        if (! is_string($named) || trim($named) === '') {
            throw new ApiException(
                ErrorCode::B2bSignatoryRequired,
                'This application has not named the person who can sign for the company.',
            );
        }

        return trim($named);
    }

    /**
     * The caller's own contact point holding the named address.
     *
     * @throws ApiException
     */
    private function actorContactFor(User $actor, string $named): ContactPoint
    {
        $normalised = $this->normaliser->normalise(ContactChannel::Email, $named);

        foreach ($this->contacts->forUser($actor, ContactChannel::Email) as $contact) {
            if ($contact->value_normalised === $normalised) {
                return $contact;
            }
        }

        throw new ApiException(
            ErrorCode::B2bSignatoryRequired,
            'Only the signatory this application names may sign it. Ask them to sign in with the address on the application and sign for themselves.',
        );
    }
}
