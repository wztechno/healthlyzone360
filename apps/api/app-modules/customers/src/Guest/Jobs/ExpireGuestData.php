<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Jobs;

use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Services\GuestDeletionService;
use Healthy360\Customers\Guest\Services\GuestRetentionWindows;
use Healthy360\Customers\Models\CustomerAccount;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * The guest retention sweep. Two passes, because expiring and forgetting are
 * different acts at different times.
 *
 * **Pass one — expire.** A guest account past `guest_expires_at` stops being a
 * live thing: it is closed and every token it holds is revoked. Nothing is
 * deleted. That distinction is the point of having two passes — the moment a
 * guest can no longer order is not the moment their data stops being needed,
 * because the delivery that went wrong is disputed the week after and the refund
 * comes after that.
 *
 * **Pass two — purge.** An account closed for longer than
 * `guest.retention.purge_after_days` has its personal data erased through the
 * same `GuestDeletionService::purge()` a proven request uses. One code path,
 * so an erasure cannot behave differently depending on who asked for it.
 *
 * **The suppression source differs, and that is deliberate.** An expiry writes
 * `opt_out`, not `deletion`: nobody asked to be forgotten here, the window
 * simply ran out, and marking it as an erasure request would make it permanent
 * — so somebody who ordered once as a guest, let the window lapse, and later
 * chose to subscribe could never be mailed again. A `deletion` is a person's
 * decision; this is a clock's.
 *
 * **Converted accounts fall out of both passes for free.** Conversion nulls
 * `guest_expires_at` and flips `account_type` to `b2c`, and both predicates are
 * in the query — so an account that became a real customer is never swept, and
 * nothing has to remember to exclude it.
 *
 * Every window is PROVISIONAL pending **OQ-030** and is presented as
 * configuration, never as a settled legal period.
 *
 * Daily at 03:30 UTC, `withoutOverlapping()` and `onOneServer()`
 * (routes/console.php) — offset from the 03:00 abandonment sweep rather than
 * sharing the hour, so two cluster-wide deletion passes do not make a slow
 * database look like a broken one.
 */
final class ExpireGuestData implements ShouldQueue
{
    use Queueable;

    /** Accounts per pass, so one run cannot hold a long lock. */
    public const int CHUNK = 100;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(GuestDeletionService $deletions, GuestRetentionWindows $windows): void
    {
        $expired = $this->expire($deletions);
        $purged = $this->purge($deletions, $windows);

        // Counts, never accounts. Logging which guests were forgotten would
        // reconstruct in the log exactly what was removed from the tables.
        Log::info('Guest retention sweep complete.', [
            'expired' => $expired,
            'purged' => $purged,
            'account_window_days' => $windows->accountDays(),
            'purge_after_days' => $windows->purgeAfterDays(),
        ]);
    }

    /**
     * Close guests whose window has passed. Nothing is deleted.
     */
    private function expire(GuestDeletionService $deletions): int
    {
        $closed = 0;
        $now = now();

        do {
            /** @var list<CustomerAccount> $batch */
            $batch = CustomerAccount::query()
                ->where('account_type', CustomerAccountType::Guest)
                ->whereNotNull('guest_expires_at')
                ->where('guest_expires_at', '<', $now)
                ->where('status', '!=', CustomerAccountStatus::Closed->value)
                ->limit(self::CHUNK)
                ->get()
                ->all();

            foreach ($batch as $account) {
                $deletions->revokeSessions($account, 'guest_window_expired');

                $account->forceFill([
                    'status' => CustomerAccountStatus::Closed,
                    'closed_at' => $account->closed_at ?? now(),
                ])->save();

                $closed++;
            }
        } while (count($batch) === self::CHUNK);

        return $closed;
    }

    /**
     * Erase guests closed for longer than the retention window.
     *
     * `anonymised_at IS NULL` is the idempotence guard: a purged account keeps
     * its closed row forever (it is the join target orders need), so without it
     * every run would purge every guest that ever existed, over and over.
     */
    private function purge(GuestDeletionService $deletions, GuestRetentionWindows $windows): int
    {
        $purged = 0;
        $cutoff = $windows->purgeCutoff();

        do {
            /** @var list<CustomerAccount> $batch */
            $batch = CustomerAccount::query()
                ->where('account_type', CustomerAccountType::Guest)
                ->where('status', CustomerAccountStatus::Closed)
                ->whereNull('anonymised_at')
                ->whereNotNull('closed_at')
                ->where('closed_at', '<', $cutoff)
                ->limit(self::CHUNK)
                ->get()
                ->all();

            foreach ($batch as $account) {
                $deletions->purge($account, SuppressionSource::OptOut);
                $purged++;
            }
        } while (count($batch) === self::CHUNK);

        return $purged;
    }
}
