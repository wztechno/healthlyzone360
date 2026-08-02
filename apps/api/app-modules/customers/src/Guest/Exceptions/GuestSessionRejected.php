<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Exceptions;

use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use RuntimeException;

/**
 * A guest token was presented and may not do what was asked of it.
 *
 * `$reason` is a stable machine token so the HTTP layer can map it to an error
 * code without parsing prose. It deliberately does **not** distinguish "no such
 * token" from "expired token" at the boundary — `GuestSessionService::resolve()`
 * returns null for both, and only a caller that already holds a live session
 * reaches the grade refusals below. A guest surface that answered "that token
 * expired" would confirm the token had once existed.
 */
final class GuestSessionRejected extends RuntimeException
{
    public const string REASON_NOT_LIVE = 'session_not_live';

    public const string REASON_INSUFFICIENT_GRADE = 'insufficient_grade';

    public const string REASON_ACCOUNT_NOT_GUEST = 'account_not_guest';

    public const string REASON_CONTACT_NOT_VERIFIED = 'contact_not_verified';

    private function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public static function notLive(): self
    {
        return new self(self::REASON_NOT_LIVE, 'This guest session is no longer usable.');
    }

    public static function insufficientGrade(GuestSessionGrade $held, GuestSessionGrade $required): self
    {
        return new self(
            self::REASON_INSUFFICIENT_GRADE,
            sprintf('A %s guest session cannot perform an action requiring %s.', $held->value, $required->value),
        );
    }

    public static function accountNotGuest(): self
    {
        return new self(self::REASON_ACCOUNT_NOT_GUEST, 'This customer account is not a guest account.');
    }

    public static function contactNotVerified(): self
    {
        return new self(self::REASON_CONTACT_NOT_VERIFIED, 'This guest session has no proven contact point.');
    }
}
