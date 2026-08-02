<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Jobs;

use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Services\GuestRetentionWindows;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Remove dead guest tokens.
 *
 * **This job is hygiene, not security.** A token stops working the moment
 * `expires_at` passes or `revoked_at` is written — `GuestSession::isLive()` asks
 * the clock, not this job — so nothing about authentication depends on it having
 * run. What it removes is a growing table of digests and hashed fingerprints
 * belonging to browsers that will never come back, which is data minimisation
 * doing its ordinary work.
 *
 * The short grace period (`guest.retention.session_rows_hours`) exists for one
 * question: an abuse report arriving the next morning asks whether a session was
 * *revoked* or merely *lapsed*, and those are different stories about the same
 * dead token. A day is long enough to read the report and short enough that this
 * is not an archive of who visited.
 *
 * Hourly rather than daily, matching `PurgeExpiredOtpChallenges`, because
 * sessions are minted per anonymous visitor and the table grows faster than any
 * other in this module.
 */
final class PurgeExpiredGuestSessions implements ShouldQueue
{
    use Queueable;

    /** Rows per statement, so one run cannot hold a long lock. */
    public const int CHUNK = 500;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(GuestRetentionWindows $windows): void
    {
        $cutoff = $windows->sessionRowCutoff();
        $deleted = 0;

        do {
            /** @var list<string> $batch */
            $batch = GuestSession::query()
                ->where(function ($query) use ($cutoff): void {
                    $query->where('expires_at', '<', $cutoff)
                        ->orWhere('revoked_at', '<', $cutoff);
                })
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            if ($batch === []) {
                break;
            }

            $deleted += GuestSession::query()->whereIn('id', $batch)->delete();
        } while (count($batch) === self::CHUNK);

        Log::info('Expired guest sessions purged.', ['deleted' => $deleted]);
    }
}
