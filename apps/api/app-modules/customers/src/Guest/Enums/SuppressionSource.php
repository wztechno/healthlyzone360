<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Enums;

/**
 * Why a destination is suppressed.
 *
 * Two values that must not be collapsed into one. `Deletion` is the residue of a
 * proven erasure request: it is the reason the erasure does not silently undo
 * itself the next time the address arrives in an import, and it is permanent —
 * lifting it would mean re-contacting somebody who asked to be forgotten.
 * `OptOut` is somebody unchecking a box, which is an ordinary preference and a
 * later opt-in may lift.
 *
 * One column, two lifetimes. A single "suppressed" flag would force a choice
 * between honouring an unsubscribe as if it were an erasure, or letting a
 * re-subscribe quietly reverse one.
 */
enum SuppressionSource: string
{
    /** The residue of a proven erasure request. Permanent. */
    case Deletion = 'deletion';

    /** A stated preference. A later opt-in may lift it. */
    case OptOut = 'opt_out';

    /**
     * Whether a later consent may remove this suppression.
     */
    public function isLiftable(): bool
    {
        return $this === self::OptOut;
    }
}
