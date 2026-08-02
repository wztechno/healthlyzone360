<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Services;

use Carbon\CarbonImmutable;

/**
 * The four provisional windows the guest journey runs on, read in one place.
 *
 * Every number here is blocked on **OQ-030** (guest data retention) and none of
 * them is a settled legal period. Centralising the reads is what makes that
 * claim checkable: when the question is answered, one file changes and one class
 * reads it, rather than a `config()` call in each of six services quietly
 * disagreeing about the default.
 *
 * The floors are not decoration. A zero-day account window would expire every
 * guest at the moment of creation, and a misconfigured `0` in a file somebody
 * edited during an incident should not be able to delete the day's customers.
 */
final class GuestRetentionWindows
{
    /** How long a minted token is accepted. */
    public function sessionExpiresAt(?CarbonImmutable $from = null): CarbonImmutable
    {
        return ($from ?? now())->addHours(max(1, (int) config('guest.windows.session_hours', 72)));
    }

    /**
     * How long the guest account itself stays live.
     *
     * Stamped once, at creation, and never recomputed — the same discipline
     * `provisional_expires_at` follows, and for the same reason: an account
     * opened under a fortnight's window must not acquire a shorter one because a
     * setting moved.
     */
    public function accountExpiresAt(?CarbonImmutable $from = null): CarbonImmutable
    {
        return ($from ?? now())->addDays(max(1, (int) config('guest.windows.account_days', 14)));
    }

    /**
     * The cutoff before which an expired guest account's personal data is
     * purged. Rows closed longer ago than this are past keeping.
     */
    public function purgeCutoff(?CarbonImmutable $now = null): CarbonImmutable
    {
        return ($now ?? now())->subDays(max(1, (int) config('guest.retention.purge_after_days', 90)));
    }

    /**
     * The cutoff before which a dead session row is removed. The token stopped
     * working when it expired; this window is only so "revoked or lapsed" stays
     * answerable while an abuse report is read.
     */
    public function sessionRowCutoff(?CarbonImmutable $now = null): CarbonImmutable
    {
        return ($now ?? now())->subHours(max(1, (int) config('guest.retention.session_rows_hours', 24)));
    }

    public function accountDays(): int
    {
        return max(1, (int) config('guest.windows.account_days', 14));
    }

    public function purgeAfterDays(): int
    {
        return max(1, (int) config('guest.retention.purge_after_days', 90));
    }
}
