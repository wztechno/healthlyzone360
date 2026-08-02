<?php

declare(strict_types=1);

namespace Healthy360\Verification\Enums;

/**
 * Where a challenge is in its short life.
 *
 * `pending` is the only live state, and the partial unique index depends on
 * that being exactly true: one pending row per contact per purpose. The four
 * terminal states are kept apart rather than collapsed into "closed" because
 * they answer different questions during an abuse review — a wave of `expired`
 * is a delivery problem, a wave of `failed` is somebody guessing, and
 * `superseded` is a person pressing resend.
 */
enum OtpChallengeStatus: string
{
    /** Live: within its window and with attempts remaining. */
    case Pending = 'pending';

    /** The right code arrived. */
    case Verified = 'verified';

    /** The window closed before anybody proved anything. */
    case Expired = 'expired';

    /** Attempts were exhausted. */
    case Failed = 'failed';

    /** A newer challenge for the same contact and purpose replaced it. */
    case Superseded = 'superseded';

    public function isLive(): bool
    {
        return $this === self::Pending;
    }
}
