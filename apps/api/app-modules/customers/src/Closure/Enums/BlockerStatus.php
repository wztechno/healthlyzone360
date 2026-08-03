<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Enums;

/**
 * What a closure blocker found.
 *
 * **Three values, and the third is the one that matters.** `blocking` and
 * `clear` are the obvious pair. `not_applicable` exists because the alternative
 * — reporting `clear` when nothing was actually checked — is the specific
 * dishonesty this whole registry was built to prevent (master plan §9): a
 * closure screen that says "no outstanding payments" when no payment module
 * exists has not checked anything, and the customer cannot tell the difference.
 *
 * `not_applicable` is therefore never a synonym for "fine". It carries a reason
 * saying *why* nothing was checked, it is rendered differently from `clear`,
 * and a blocker that returns it permanently is a defect rather than a state —
 * which is what the payment tripwire test asserts by failing the build the
 * moment a `%payment%` table appears without a blocker that can see it.
 */
enum BlockerStatus: string
{
    /** Something real stands in the way. The closure does not proceed. */
    case Blocking = 'blocking';

    /** Checked, and there is nothing here. */
    case Clear = 'clear';

    /**
     * Not checked, because there is nothing in this deployment to check
     * against. Never presented as `clear`.
     */
    case NotApplicable = 'not_applicable';

    /**
     * Whether this verdict stops a closure.
     *
     * `not_applicable` does not, and that is a considered risk rather than an
     * oversight: refusing every closure until every future module exists would
     * make the journey unusable, so the honesty is carried in the reporting and
     * in the tripwire instead.
     */
    public function stopsClosure(): bool
    {
        return $this === self::Blocking;
    }
}
