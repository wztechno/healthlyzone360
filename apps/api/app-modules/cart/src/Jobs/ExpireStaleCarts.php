<?php

declare(strict_types=1);

namespace Healthy360\Cart\Jobs;

use Healthy360\Cart\Enums\CartStatus;
use Healthy360\Cart\Models\Cart;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Close the baskets nobody came back to.
 *
 * **Closed, never deleted.** An expired cart is the record of what somebody
 * nearly ordered — the thing an abandonment figure is computed from and the
 * thing a "resume your basket" link would restore. What expiry actually does
 * is free the customer's one-open-cart slot on that channel, so their next
 * visit starts cleanly instead of colliding with a partial unique index.
 *
 * The status change is done in a single `UPDATE` per batch rather than through
 * `CartService::expire`, and that is a deliberate trade. The service records
 * an audit event per cart, which is right when a person expires a basket and
 * wrong when a nightly sweep closes four thousand: the audit trail would fill
 * with rows describing the passage of time. The sweep logs one count instead.
 *
 * Batched so one run cannot hold a long lock, and idempotent — a cart already
 * `expired` or `converted` is not matched, so a retry or an overlapping run
 * does nothing twice. Daily, `withoutOverlapping` and `onOneServer`
 * (routes/console.php).
 */
final class ExpireStaleCarts implements ShouldQueue
{
    use Queueable;

    /** Carts per statement. */
    public const int CHUNK = 500;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(): void
    {
        $now = now();
        $expired = 0;

        do {
            /** @var list<string> $batch */
            $batch = Cart::query()
                ->where('status', CartStatus::Open)
                ->where('expires_at', '<', $now)
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            if ($batch === []) {
                break;
            }

            $expired += DB::transaction(fn (): int => Cart::query()
                ->whereIn('id', $batch)
                ->update(['status' => CartStatus::Expired->value, 'updated_at' => $now]));
        } while (count($batch) === self::CHUNK);

        // A count, never the carts. Which customer abandoned which basket is
        // not something an operational log needs to carry.
        Log::info('Stale carts expired.', ['expired' => $expired]);
    }
}
