<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Results;

/**
 * The answer to a submitted deletion passcode.
 *
 * Enumeration resistance survives the second step or it was never there. There
 * is exactly one failure shape, and the list of things it covers is the point:
 *
 *  * a wrong code against an address we hold,
 *  * any code at all against an address we do not,
 *  * a challenge that expired,
 *  * a contact point that is locked out after repeated failures.
 *
 * The last one is the least obvious and the most important. A distinct
 * "locked out" would be a perfect oracle — an attacker submits six digits five
 * times and reads *the refusal that only a real contact point can produce*. So
 * the lockout is enforced (it is `OtpService`'s, unchanged) and simply not
 * described. A refusal that names its reason is a refusal that answers a
 * question nobody asked.
 *
 * `$report` is populated only on success, where the requester has proven they
 * hold the destination and is therefore entitled to be told what became of
 * their own data.
 */
final readonly class GuestDeletionOutcome
{
    public const string REASON_INVALID = 'invalid_verification';

    public function __construct(
        public bool $purged,
        public ?string $reason = null,
        public ?GuestPurgeReport $report = null,
    ) {}

    public static function purged(GuestPurgeReport $report): self
    {
        return new self(purged: true, report: $report);
    }

    /**
     * The single failure shape. Callers do not choose a reason — there is only
     * one, on purpose.
     */
    public static function refused(): self
    {
        return new self(purged: false, reason: self::REASON_INVALID);
    }
}
