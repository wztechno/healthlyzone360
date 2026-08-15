<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Concerns;

use App\Models\User;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpVerificationResult;
use Illuminate\Http\Request;

/**
 * The passcode half of signing an agreement.
 *
 * A near-twin of the verification module's `HandlesOtpChallenges`, and
 * **copied rather than imported**, which is the rule this codebase states
 * about traits: a trait is a copied implementation either way, and reaching
 * across a module boundary for it would buy a dependency edge rather than
 * remove duplication. The *types* both modules must agree on —
 * `OtpChallenge`, `OtpVerificationResult`, the `otp.*` codes — do cross the
 * boundary, because those are a contract rather than an implementation.
 *
 * Three rules are worth stating in their own right.
 *
 * **The challenge is located by owner, and a stranger's is a 404.** A challenge
 * is a credential in flight; a 403 would confirm that an identifier names a
 * real one, which is exactly the fact somebody holding a stolen identifier is
 * trying to establish.
 *
 * **The purpose is checked before the code is compared.** Verifying first
 * would spend one of three attempts on a challenge that was never going to be
 * honoured, so an attacker could burn a signatory's allowance by pointing this
 * endpoint at their contact-verification challenge. Refusing on the purpose
 * costs nothing and burns nothing.
 *
 * **The session corroboration is keyed, not bare.** `SigningEvidence` takes
 * hashes of the address and the user agent so that "did the acceptance come
 * from the same session as the rest of the conversation" is answerable without
 * retaining either value. A plain SHA-256 of an IPv4 address is a
 * thirty-two-bit search space and therefore not a hash at all, so both digests
 * are HMAC-SHA-256 under the application key — the same argument, and the same
 * construction, the verification module makes for `otp_challenges`.
 */
trait HandlesSignatureChallenges
{
    /**
     * This caller's signatory challenge, or nothing at all.
     *
     * The purpose is part of the lookup rather than a check after it, so a
     * challenge raised for logging in cannot be spent on a signature and the
     * refusal reveals nothing about which of the two conditions failed.
     *
     * @throws ApiException
     */
    protected function signatoryChallengeFor(User $actor, string $challengeId): OtpChallenge
    {
        $challenge = OtpChallenge::query()
            ->whereKey($challengeId)
            ->where('user_id', $actor->getKey())
            ->where('purpose', OtpPurpose::B2bSignatory->value)
            ->first();

        if (! $challenge instanceof OtpChallenge) {
            throw new ApiException(ErrorCode::B2bSignatoryRequired);
        }

        return $challenge;
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

    protected function requestIpHash(Request $request): ?string
    {
        return $this->keyedDigest($request->ip());
    }

    protected function requestUserAgentHash(Request $request): ?string
    {
        return $this->keyedDigest($request->userAgent());
    }

    private function keyedDigest(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return hash_hmac('sha256', $value, (string) config('app.key'));
    }
}
