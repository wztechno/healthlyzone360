<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Jobs;

use Healthy360\Inventory\Services\ConsumptionExceptionSweep;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Retry the open stock gaps of one kitchen, or of every kitchen that has any
 * ({@see ConsumptionExceptionSweep}).
 *
 * Dispatched for one organisation the moment stock rises on one of its shelves
 * ({@see \Healthy360\Inventory\Services\InventoryService::recordMovement()}) —
 * a receipt, a delivery, a count, a finished batch — and scheduled for all of
 * them every five minutes, which is what closes a gap fixed anywhere else: a
 * recipe published, a unit set, a branch opened, a batch's claim released.
 *
 * **Unique until it starts.** A receipt with twelve lines raises stock twelve
 * times; while one sweep for the kitchen is waiting, the other eleven collapse
 * into it. The lock is released when the sweep *starts*, not when it ends, so
 * stock that lands while it is running queues one more pass rather than being
 * lost behind a sweep that has already passed its line. `$uniqueFor` bounds the
 * lock so a lost worker cannot stop a kitchen's gaps from retrying.
 *
 * **Tenancy is re-established, not inherited**, for the reason
 * `RecomputeRecipeDerivations` gives: the worker has no request behind it.
 */
final class RetryOpenConsumptionExceptions implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $uniqueFor = 300;

    /**
     * @param  string|null  $organisationId  one kitchen, or null for every kitchen with an open gap
     */
    public function __construct(public ?string $organisationId = null)
    {
        $this->onQueue('default');
    }

    /**
     * Queue a sweep for one kitchen from inside a write, leaving the writer's tenant context as it
     * found it.
     *
     * On the sync queue the job runs in the writer's own process, and every job attempt clears the
     * tenant context (`TenancyServiceProvider`) — so a receipt's next line would run with none. The
     * snapshot is put back only when the dispatch changed it: on a real queue nothing ran here, and
     * restoring would drop the membership the request resolved.
     */
    public static function queueFor(string $organisationId): void
    {
        $context = app(TenantContext::class);
        $caller = $context->toArray();

        self::dispatch($organisationId);

        if ($context->toArray() !== $caller) {
            $context->restore($caller);
        }
    }

    public function uniqueId(): string
    {
        return $this->organisationId ?? 'all';
    }

    public function handle(
        ConsumptionExceptionSweep $sweep,
        DatabaseTenantContext $database,
        TenantContext $context,
    ): void {
        $organisationIds = $this->organisationId === null
            ? $sweep->organisationsWithOpenGaps()
            : [$this->organisationId];

        $ambient = $context->toArray();

        try {
            foreach ($organisationIds as $organisationId) {
                $closed = $database->during(null, $organisationId, null, static function () use ($sweep, $context, $organisationId): int {
                    $context->restore(['user_id' => null, 'organisation_id' => $organisationId, 'branch_id' => null]);

                    return $sweep->retryOpen($organisationId);
                });

                if ($closed > 0) {
                    Log::info('Stock gaps closed by an automatic retry.', [
                        'organisation_id' => $organisationId,
                        'closed' => $closed,
                    ]);
                }
            }
        } finally {
            $context->restore($ambient);
        }
    }
}
