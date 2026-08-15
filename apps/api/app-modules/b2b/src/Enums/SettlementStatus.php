<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * Where an offboarding stands on money.
 *
 * Three values, and the third is the important one. `waived` is not a variety
 * of `cleared`: it records that a human with the authority to do so decided
 * the outstanding position did not need resolving before access was removed.
 * Collapsing the two would erase the difference between "we checked and there
 * was nothing owed" and "somebody decided to let it go", which is precisely
 * the difference a later dispute turns on.
 *
 * A waiver therefore carries a person and a reason on the row — the database
 * CHECK insists on both — and is audited under its own action.
 */
enum SettlementStatus: string
{
    /** Not yet run, or run and something came back unclear. */
    case Pending = 'pending';

    /** Every check answered clear or honestly not-applicable. */
    case Cleared = 'cleared';

    /** An outstanding position was set aside by somebody authorised to. */
    case Waived = 'waived';

    /** Whether the offboarding may move on to sign-off. */
    public function permitsSignoff(): bool
    {
        return $this !== self::Pending;
    }
}
