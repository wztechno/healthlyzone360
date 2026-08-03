<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Controllers;

use App\Models\User;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Http\Concerns\HandlesOtpChallenges;
use Healthy360\Verification\Http\Requests\StoreStepUpChallengeRequest;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/verification/step-up/challenges — prove you are holding the
 * phone.
 *
 * A step-up passcode answers a different question from a password
 * confirmation. "Does this person know the secret" and "is this person present
 * right now" are not the same assurance, which is why the two methods are
 * tracked separately and neither satisfies the other, and why the passcode
 * window is ten minutes against the password's three hours.
 *
 * **The destination is chosen by the server**, from the contacts the account has
 * already proven — the primary one where there is one. A caller that could name
 * a destination for a challenge that unlocks account closure would be handed
 * the single decision the server exists to make here.
 *
 * The purpose is confined to those `OtpPurpose::grantsStepUp()` admits, and
 * that check happens twice on purpose: the form request refuses an unlisted
 * purpose at the door, and the confirm endpoint refuses to honour a challenge
 * whose purpose does not grant a step-up even if one somehow reached it. A code
 * obtained for a harmless purpose must not be replayable against a dangerous
 * one, and that property is worth two cheap checks.
 *
 * 202: a message has been queued.
 */
final class StepUpChallengeStoreController
{
    use HandlesOtpChallenges;

    public function __construct(
        private readonly OtpService $otp,
        private readonly ContactPointRegistry $contacts,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreStepUpChallengeRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $contact = $this->stepUpDestination($user);

        $result = $this->otp->issue(
            contact: $contact,
            purpose: OtpPurpose::from($request->payload()['purpose']),
            requestIpHash: $this->requestIpHash($request),
        );

        return ApiResponse::data(['challenge' => $result->toArray()], status: 202);
    }

    /**
     * The proven destination a step-up is sent to.
     *
     * Primary first, then any verified contact, because a person who has proven
     * a phone and an address should be challenged on the one they nominated
     * rather than on whichever row was written first. Unverified contacts are
     * not candidates at all: sending a step-up to an unproven destination would
     * make the step-up worth exactly as much as the claim behind it.
     *
     * This route sits behind `verified`, so the empty case is unreachable for a
     * real caller; it is answered as `otp.channel_unavailable` with an empty
     * `available_channels` rather than left to a type error, because "there is
     * nowhere to send this" is precisely what that code says.
     *
     * @throws ApiException
     */
    private function stepUpDestination(User $user): ContactPoint
    {
        $verified = array_values(array_filter(
            $this->contacts->forUser($user),
            static fn (ContactPoint $contact): bool => $contact->isVerified(),
        ));

        foreach ($verified as $contact) {
            if ($contact->is_primary) {
                return $contact;
            }
        }

        if ($verified === []) {
            throw new ApiException(
                ErrorCode::OtpChannelUnavailable,
                'No verified contact is available to send a passcode to.',
                ['available_channels' => []],
            );
        }

        return $verified[0];
    }
}
