<?php

declare(strict_types=1);

namespace Healthy360\Verification\Exceptions;

use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * A passcode was not issued, and the reason is one a client must be able to
 * branch on.
 *
 * Stable reason strings rather than error codes, for the reason recorded on
 * every J1 domain exception: the wire vocabulary is owned by the HTTP
 * follow-up, and two vocabularies would have to be reconciled later. The
 * `details()` payload is already the shape those responses need — a cooldown
 * has to say when, and a lockout has to say until when, or the client has
 * nothing to count down.
 */
final class OtpIssueRefused extends RuntimeException
{
    /**
     * @param  array<string, scalar>  $details
     */
    private function __construct(
        private readonly string $reason,
        string $message,
        private readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function cooldown(CarbonImmutable $availableAt): self
    {
        return new self(
            'otp.resend_too_soon',
            'A code was just sent. Wait a moment before asking for another.',
            [
                'resend_available_at' => $availableAt->toIso8601String(),
                'retry_after_seconds' => max(0, $availableAt->diffInSeconds(now(), absolute: false)),
            ],
        );
    }

    public static function resendLimit(): self
    {
        return new self('otp.resend_limit_reached', 'That code has been sent as many times as it can be. Start again.');
    }

    public static function lockedOut(CarbonImmutable $until): self
    {
        return new self(
            'otp.locked_out',
            'Too many incorrect codes. Try again later.',
            ['locked_until' => $until->toIso8601String()],
        );
    }

    public static function notLive(): self
    {
        return new self('otp.challenge_not_live', 'That verification is no longer active.');
    }

    /**
     * A purpose whose journey has not been built. A programming error rather
     * than a user-facing one, and it fails loudly for that reason: a challenge
     * verified for a purpose with no consumer is a step-up nothing knows how
     * to honour.
     */
    public static function purposeNotIssuable(string $purpose): self
    {
        return new self('otp.purpose_not_issuable', "No journey issues {$purpose} challenges yet.");
    }

    public static function contactUnusable(): self
    {
        return new self('otp.contact_unusable', 'That contact cannot be verified.');
    }

    public function reason(): string
    {
        return $this->reason;
    }

    /**
     * @return array<string, scalar>
     */
    public function details(): array
    {
        return $this->details;
    }
}
