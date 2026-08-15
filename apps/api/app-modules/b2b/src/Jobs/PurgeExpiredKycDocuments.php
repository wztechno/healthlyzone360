<?php

declare(strict_types=1);

namespace Healthy360\B2b\Jobs;

use Healthy360\B2b\Services\KycDocumentService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Delete identity documents whose retention window has closed.
 *
 * A passport scan the platform no longer has a reason to hold is a liability
 * rather than an asset, and the reason it holds one is the KYC decision it
 * supported. `purge_after` is stamped at upload from
 * `b2b.kyc.retention_days` — a **placeholder pending the retention decision**
 * (OQ-029), never presented as a settled legal period — and this job is what
 * makes the stamp mean something.
 *
 * Object first, row second, one row at a time. The service explains the
 * ordering: a crash between the two leaves a row pointing at bytes that are
 * gone, which the next run cleans up, whereas the reverse leaves bytes in a
 * bucket that nothing knows about.
 *
 * Weekly rather than daily, and `CHUNK` rather than everything: retention here
 * is measured in years, so nothing is urgent, and a sweep that deleted
 * thousands of objects in one run would hold a queue worker for as long as the
 * bucket took to answer.
 *
 * `withoutOverlapping()` and `onOneServer()` are set on the schedule entry
 * (routes/console.php) for the reasons J1's two purge jobs give: concurrent
 * runs would interleave batches, and a cluster-wide sweep multiplied by the
 * number of application servers is the same work done many times.
 */
final class PurgeExpiredKycDocuments implements ShouldQueue
{
    use Queueable;

    /** Documents per run. Retention is measured in years; nothing is urgent. */
    public const int CHUNK = 200;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(KycDocumentService $documents): void
    {
        $purged = $documents->purgeExpired(self::CHUNK);

        if ($purged === 0) {
            return;
        }

        // The count only. Never an identifier, a path or an owner — a log line
        // that named which company's documents were deleted would recreate, in
        // a place with looser access, the record the deletion just removed.
        Log::info('Purged KYC documents past their retention window.', ['purged' => $purged]);
    }
}
