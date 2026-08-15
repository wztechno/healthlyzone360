<?php

declare(strict_types=1);

namespace Healthy360\Verification\Http\Concerns;

use App\Models\User;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpVerificationResult;
use Illuminate\Http\Request;

/**
 * The three things every passcode endpoint has to do, and not one of them
 * belongs in a service.
 *
 * **Locating a challenge is an authorisation decision wearing a lookup's
 * clothes.** Every read and every write here is scoped to `user_id` and answers
 * `resource.not_found` when the row belongs to somebody else — never 403. A 403
 * would confirm that the identifier names a real challenge, which is precisely
 * the fact an attacker holding a stolen identifier is trying to establish, and
 * a challenge is a credential in flight.
 *
 * **A failed verification is a value, not an exception.** `OtpService::verify()`
 * returns `OtpVerificationResult` for the ordinary case — somebody mistyped —
 * because the caller needs the same fields either way. The HTTP layer is where
 * that stops being ordinary, so the mapping from the result's stable `reason`
 * onto the `otp.*` error vocabulary lives here and only here. Every other
 * refusal in this module is a domain exception that renders itself, so this is
 * the one translation the controllers own.
 *
 * **The address is hashed with a key, never bare.** `otp_challenges` records a
 * hashed client address so a flood can be recognised without keeping the
 * address; a plain SHA-256 of an IPv4 address would be a thirty-two-bit search
 * space and therefore not a hash at all. Keying it with the application secret
 * is what makes the column the one-way record its comment claims.
 */
trait HandlesOtpChallenges
{
    /**
     * Narrows the guard's Authenticatable to the concrete Healthy360 identity.
     *
     * Every route using this is already behind `auth:sanctum`, so the failure
     * branch is unreachable in practice — it exists so a routing mistake fails
     * closed with `auth.unauthenticated` rather than with a type error.
     *
     * @throws ApiException
     */
    protected function currentUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }

    /**
     * This caller's challenge, or nothing at all.
     *
     * @throws ApiException
     */
    protected function challengeFor(User $user, string $challengeId): OtpChallenge
    {
        $challenge = OtpChallenge::query()
            ->whereKey($challengeId)
            ->where('user_id', $user->getKey())
            ->first();

        if (! $challenge instanceof OtpChallenge) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $challenge;
    }

    /**
     * The caller's login mirror, created on demand for accounts that predate
     * it.
     *
     * Registration writes this row in the same transaction as the user
     * (`CreateNewUser`), so in practice it always exists; the fallback covers
     * accounts created before the J1 migration and the seeded demo users, where
     * the alternative — refusing to issue a code — would be a silent difference
     * in behaviour between old accounts and new ones. It is the same fallback
     * `EmailVerificationMessenger` performs, for the same reason.
     *
     * The registry is passed rather than injected because a trait has no
     * constructor to promote it into, and reaching for the container from
     * inside a shared method would hide a dependency two controllers already
     * declare in the open.
     *
     * @throws InvalidContactValue
     */
    protected function loginContact(User $user, ContactPointRegistry $contacts): ContactPoint
    {
        $contact = $user->loginContact()->first();

        if ($contact instanceof ContactPoint) {
            return $contact;
        }

        return $contacts->rememberForUser(
            user: $user,
            channel: ContactChannel::Email,
            value: $user->email,
            isLoginIdentity: true,
            isPrimary: true,
            source: 'registration',
        );
    }

    /**
     * Turn a refused attempt into the error the client branches on.
     *
     * `attempts_remaining` rides on the wrong-code case because a client that
     * cannot show "2 tries left" leaves the person guessing when to stop, and
     * `locked_until` rides on the lockout because "try again later" without a
     * time is an instruction nobody can follow.
     *
     * @throws ApiException
     */
    protected function assertVerified(OtpVerificationResult $result): void
    {
        if ($result->verified) {
            return;
        }

        throw match ($result->reason) {
            OtpVerificationResult::REASON_EXPIRED,
            OtpVerificationResult::REASON_NOT_LIVE => new ApiException(ErrorCode::OtpExpired),

            OtpVerificationResult::REASON_ATTEMPTS_EXHAUSTED => new ApiException(ErrorCode::OtpAttemptsExceeded),

            OtpVerificationResult::REASON_LOCKED_OUT => new ApiException(
                ErrorCode::OtpLocked,
                details: ['locked_until' => $result->lockedUntil?->toIso8601String()],
            ),

            // Including an unrecognised reason. A new failure mode must not
            // arrive on the wire as "verified" because a match arm was missed.
            default => new ApiException(
                ErrorCode::OtpInvalid,
                details: ['attempts_remaining' => $result->attemptsRemaining],
            ),
        };
    }

    /**
     * The keyed digest of the client address, or null when there is none.
     */
    protected function requestIpHash(Request $request): ?string
    {
        $address = $request->ip();

        if ($address === null || $address === '') {
            return null;
        }

        return hash_hmac('sha256', $address, (string) config('app.key'));
    }
}
