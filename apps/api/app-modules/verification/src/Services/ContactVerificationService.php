<?php

declare(strict_types=1);

namespace Healthy360\Verification\Services;

use App\Models\User;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Exceptions\ChannelUnavailable;
use Healthy360\Verification\Exceptions\OtpIssueRefused;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpChallengeResult;
use Healthy360\Verification\Results\OtpVerificationResult;
use Illuminate\Auth\Events\Verified;
use Illuminate\Support\Facades\DB;

/**
 * Proving a contact point, end to end.
 *
 * `OtpService` knows about codes; this knows what a verified code *means*. The
 * split matters because J2's closure step-up and B1's signature will verify
 * codes without any contact becoming verified, and folding the two together
 * would make every future consumer inherit this one's side effects.
 *
 * **The login mirror is settled in both directions.** Verifying the login
 * contact by passcode also marks `users.email_verified_at` and raises
 * `Verified`, exactly as the signed link does — which in turn runs the
 * identity listener that stamps the contact. The two paths converge on the
 * same pair of facts rather than each maintaining half of them, and the whole
 * thing is one transaction so a crash cannot leave the mirror disagreeing with
 * the account (§4.10).
 *
 * The `Verified` event is raised **after** the transaction commits. Raising it
 * inside would let a listener observe — or, worse, act on — a verification
 * that a later failure rolls back.
 */
final class ContactVerificationService
{
    public function __construct(
        private readonly OtpService $otp,
        private readonly ContactPointRegistry $contacts,
    ) {}

    /**
     * Send a code to this destination.
     *
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    public function start(ContactPoint $contact, ?OtpChannel $channel = null, ?string $requestIpHash = null): OtpChallengeResult
    {
        return $this->otp->issue(
            contact: $contact,
            purpose: OtpPurpose::ContactVerification,
            channel: $channel,
            requestIpHash: $requestIpHash,
        );
    }

    /**
     * Send it again, subject to the cooldown and the resend allowance.
     *
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    public function resend(OtpChallenge $challenge, ?OtpChannel $channel = null): OtpChallengeResult
    {
        return $this->otp->resend($challenge, $channel);
    }

    /**
     * Check a code and, if it is right, mark the destination proven.
     *
     * @throws OtpIssueRefused when the challenge cannot be attempted at all
     * @throws InvalidContactValue when the value has meanwhile been proven elsewhere
     */
    public function confirm(OtpChallenge $challenge, string $code): OtpVerificationResult
    {
        $result = $this->otp->verify($challenge, $code);

        if (! $result->verified) {
            return $result;
        }

        $contact = $challenge->contactPoint()->first();

        if (! $contact instanceof ContactPoint) {
            return $result;
        }

        $user = $this->settle($contact);

        if ($user instanceof User) {
            event(new Verified($user));
        }

        return $result;
    }

    /**
     * Write both halves of the fact, atomically.
     *
     * @return User|null the account whose email this verification also
     *                   settled, when it was the login mirror
     *
     * @throws InvalidContactValue
     */
    private function settle(ContactPoint $contact): ?User
    {
        return DB::transaction(function () use ($contact): ?User {
            $this->contacts->markVerified($contact);

            if (! $contact->is_login_identity || $contact->user_id === null) {
                return null;
            }

            $user = User::query()->whereKey($contact->user_id)->first();

            if (! $user instanceof User || $user->hasVerifiedEmail()) {
                return null;
            }

            $user->forceFill(['email_verified_at' => now()])->save();

            return $user;
        });
    }
}
