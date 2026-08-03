<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Jobs;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * The safety net under the grace window.
 *
 * `ClosureService::schedule()` already dispatches a delayed
 * `FinaliseAccountClosure` for every verified request, so on a healthy day this
 * sweep finds nothing. It exists for the days that are not healthy: a queue
 * flushed during a deploy, a Redis restart, a worker that died holding a
 * reserved job, a grace window long enough that the delayed job outlived the
 * infrastructure it was queued on.
 *
 * **A closure that silently never happens is the worst failure this module
 * has.** Every other failure is visible — the customer sees a refusal, the
 * blocker explains itself, the audit row is missing. A dropped delayed job
 * looks exactly like success: the person was told their account would close,
 * the request row says `scheduled`, and nothing ever runs. A daily sweep turns
 * that into a one-day delay.
 *
 * It re-dispatches rather than finalising inline, so there is one code path
 * into the erasure and one place the blockers are re-checked. Requests due but
 * unfinished are the only thing it looks for; `FinaliseAccountClosure` refuses
 * anything that is not still `scheduled`, so a race between the delayed job and
 * this sweep costs a no-op rather than a double erasure.
 */
final class ProcessScheduledClosures implements ShouldQueue
{
    use Queueable;

    /** Requests per pass, so one run cannot hold a long lock. */
    public const int CHUNK = 100;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(): void
    {
        $now = CarbonImmutable::now();
        $dispatched = 0;

        do {
            /** @var list<string> $batch */
            $batch = AccountClosureRequest::query()
                ->where('status', ClosureRequestStatus::Scheduled->value)
                ->whereNotNull('scheduled_for')
                ->where('scheduled_for', '<=', $now)
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            foreach ($batch as $id) {
                FinaliseAccountClosure::dispatch($id);
                $dispatched++;
            }
        } while (count($batch) === self::CHUNK);

        if ($dispatched > 0) {
            // Counts, never identities — and logged only when there is
            // something to say, because a daily "0 closures" line trains
            // everybody to stop reading the one that says 40.
            Log::info('Scheduled account closures dispatched.', ['dispatched' => $dispatched]);
        }
    }
}
