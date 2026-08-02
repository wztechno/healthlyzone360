<?php

declare(strict_types=1);

namespace Healthy360\Verification\Results;

use Carbon\CarbonImmutable;
use Healthy360\Verification\Models\OtpChallenge;

/**
 * The outcome of an attempt.
 *
 * A result object rather than an exception on the failure path, because a
 * wrong code is an ordinary event in a working system — most people mistype
 * once — and the caller needs the same fields whether it succeeded or not.
 * Exceptions are kept for the states that stop the journey (locked out,
 * challenge gone), where there is no "attempts remaining" to report.
 *
 * `reason` is a stable machine key; the HTTP follow-up maps it onto the
 * `otp.*` error vocabulary.
 */
final readonly class OtpVerificationResult
{
    public const string REASON_INVALID_CODE = 'otp.invalid_code';

    public const string REASON_EXPIRED = 'otp.expired';

    public const string REASON_ATTEMPTS_EXHAUSTED = 'otp.attempts_exhausted';

    public const string REASON_LOCKED_OUT = 'otp.locked_out';

    public const string REASON_NOT_LIVE = 'otp.challenge_not_live';

    public function __construct(
        public bool $verified,
        public OtpChallenge $challenge,
        public int $attemptsRemaining,
        public ?string $reason = null,
        public ?CarbonImmutable $lockedUntil = null,
    ) {}

    public static function success(OtpChallenge $challenge): self
    {
        return new self(true, $challenge, $challenge->attemptsRemaining());
    }

    public static function failure(OtpChallenge $challenge, string $reason, ?CarbonImmutable $lockedUntil = null): self
    {
        return new self(false, $challenge, $challenge->attemptsRemaining(), $reason, $lockedUntil);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'verified' => $this->verified,
            'challenge_id' => (string) $this->challenge->getKey(),
            'attempts_remaining' => $this->attemptsRemaining,
            'reason' => $this->reason,
            'locked_until' => $this->lockedUntil?->toIso8601String(),
        ], static fn (mixed $value): bool => $value !== null);
    }
}
