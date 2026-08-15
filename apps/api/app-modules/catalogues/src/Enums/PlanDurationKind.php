<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Enums;

/**
 * Whether a plan duration is a fixed run of days or a single purchase.
 *
 * **This enum is what replaced the zero-day sentinel** (master plan §4.3). The
 * legacy design wrote "not a subscription, just a one-off order" as a duration
 * of `0` days — a magic value that reads as data, that every consumer has to
 * know the convention for, and that a per-day calculation divides by. Making
 * the *kind* explicit and the *number* nullable puts the meaning in the column
 * that carries it, and 5, 20, 40 and 60 days stay ordinary `fixed_days` rows.
 */
enum PlanDurationKind: string
{
    case OneOff = 'one_off';
    case FixedDays = 'fixed_days';

    /** Whether a row of this kind carries a `duration_days` number at all. */
    public function carriesDays(): bool
    {
        return $this === self::FixedDays;
    }
}
