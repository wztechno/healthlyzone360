<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Jobs;

use Healthy360\Subscriptions\Services\GenerationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * The hourly tick that turns tomorrow's schedule into today's orders.
 *
 * **Hourly rather than daily, and the reason is the cut-off.** A delivery
 * becomes real at the moment its change window closes (§2, §4), and that moment
 * is a per-plan, per-branch, per-timezone instant — 24 hours before a Beirut
 * Tuesday is not the same clock reading as 24 hours before a Dubai one, and a
 * kitchen may configure 36 hours instead. A daily sweep would either generate
 * some orders up to 23 hours early, which is exactly the pre-creation §4
 * forbids, or up to 23 hours late, by which time the kitchen has already
 * planned its production without them. Hourly bounds the error at an hour in
 * one direction only: never early, at most an hour late.
 *
 * **Idempotent three times over**, because a scheduled job that runs twice is
 * an ordinary Tuesday: the `subscription_deliveries` unique index refuses a
 * second row for the same day; the delivery row is claimed before the order is
 * placed, so a race is decided by PostgreSQL rather than by timing; and the
 * placement carries a derived idempotency key, so even a repeated claim replays
 * into the same order.
 *
 * `withoutOverlapping()` and `onOneServer()` are set in `routes/console.php`
 * with an explicit `name()`, for the reason that file records: the mutex key
 * derives from the name, and an anonymous scheduled job shares a key with every
 * other one — which is how a `withoutOverlapping` that looks correct protects
 * nothing.
 *
 * The log line carries counts and no identifiers. Which customer received which
 * delivery is on the subscription's own ledger and in the audit trail; an
 * operational log does not need to name anybody to say the tick ran.
 */
final class GenerateSubscriptionDeliveries implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(GenerationService $generation): void
    {
        $tally = $generation->tick();

        Log::info('Subscription deliveries generated.', $tally);
    }
}
