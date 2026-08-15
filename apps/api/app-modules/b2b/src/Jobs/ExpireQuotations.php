<?php

declare(strict_types=1);

namespace Healthy360\B2b\Jobs;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Services\QuotationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Close the quotations nobody decided on in time (B5: seven days from
 * `quoted_at`).
 *
 * A thin wrapper — `QuotationService::expireDue()` already batches the
 * `UPDATE` and logs its own count, exactly as `ExpireStaleCarts` does for the
 * same reason. Daily, `withoutOverlapping()` and `onOneServer()`
 * (routes/console.php).
 */
final class ExpireQuotations implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(QuotationService $quotations): void
    {
        $quotations->expireDue(CarbonImmutable::now());
    }
}
