<?php

declare(strict_types=1);

namespace Healthy360\B2b\Jobs;

use Healthy360\B2b\Services\ExportService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Delete the record bundles whose download window has closed.
 *
 * A records export is the most concentrated collection of one company's data
 * the platform ever produces, and a copy of it sitting in a bucket
 * indefinitely is a liability the reason for making it does not justify. The
 * window (`b2b.exports.ttl_days`) is stamped onto each row at build time, so a
 * later configuration change does not retroactively move bundles that already
 * exist — each keeps the deadline it was given, exactly as a KYC document
 * keeps its `purge_after`.
 *
 * **The row survives the object.** `expired` is a state the purge writes, not
 * a comparison against a clock, and the manifest stays on the row — so "what
 * did we hand this company, and when" remains answerable after the bytes are
 * gone. Deleting the row would erase the evidence that an export was ever
 * made, which is the thing a data-protection enquiry asks about.
 *
 * Daily rather than weekly, because unlike KYC retention this window is
 * measured in days: an export that expired on Tuesday should not still be
 * downloadable on Friday. `withoutOverlapping()` and `onOneServer()` are on
 * the schedule entry (routes/console.php) for the reason every other sweep
 * carries them — concurrent runs would interleave batches, and a cluster-wide
 * pass multiplied by the number of application servers is the same work done
 * many times.
 */
final class PurgeExpiredRecordExports implements ShouldQueue
{
    use Queueable;

    /** Bundles per run. Each one is an object deletion against the bucket. */
    public const int CHUNK = 100;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(ExportService $exports): void
    {
        $purged = $exports->purgeExpired(self::CHUNK);

        if ($purged === 0) {
            return;
        }

        // The count only. Naming which company's export was deleted would
        // recreate, in a place with looser access, part of the record the
        // deletion just removed.
        Log::info('Purged record exports past their download window.', ['purged' => $purged]);
    }
}
