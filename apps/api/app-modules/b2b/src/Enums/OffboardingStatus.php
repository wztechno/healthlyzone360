<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The six states of a corporate relationship ending (appendix C, B.6).
 *
 * **Shell vocabulary — B2 owns the behaviour.** Declared in B1 so the table
 * and the model can be honest about their own shape; no service transitions
 * anything through it yet.
 *
 * `revoking` is separate from `completed` because revoking every member's
 * access is the step that can partially fail. A status that folded it into the
 * terminal state would let a half-revoked organisation read as finished, which
 * is the one outcome an offboarding must never report.
 *
 * `settlement_pending` is honest about a gap rather than hiding it: there is
 * no invoicing to settle against until PAY1, so B2's implementation will have
 * to say what it actually checked instead of showing a permanently-green tick.
 */
enum OffboardingStatus: string
{
    case Requested = 'requested';

    case NoticeServed = 'notice_served';

    case SettlementPending = 'settlement_pending';

    case SignedOff = 'signed_off';

    case Revoking = 'revoking';

    case Completed = 'completed';

    public function isTerminal(): bool
    {
        return $this === self::Completed;
    }
}
