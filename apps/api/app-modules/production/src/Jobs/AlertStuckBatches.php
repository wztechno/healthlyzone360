<?php

declare(strict_types=1);

namespace Healthy360\Production\Jobs;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Tell the managers about a batch that has been in production for two days:
 * food that was started and never finished or abandoned is either on a shelf
 * with no record or in a bin with none.
 *
 * **Once a batch.** {@see StaffAlerts} writes one row per recipient and batch,
 * so a daily run repeats safely.
 *
 * **Each kitchen inside its own `during()`, and one kitchen's failure goes no
 * further**, for the reasons `EscalateUnacceptedOrders` gives. The shape is
 * `AlertExpiringStock`'s.
 */
final class AlertStuckBatches implements ShouldQueue
{
    use Queueable;

    /** How long a batch may stay in production before a manager hears of it. */
    public const int HOURS = 48;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(DatabaseTenantContext $database, StaffAlerts $alerts): void
    {
        $before = CarbonImmutable::now()->subHours(self::HOURS);

        foreach ($this->tradingKitchens() as $organisationId) {
            try {
                $database->during(null, $organisationId, null, function () use ($alerts, $organisationId, $before): void {
                    $batches = DB::table('production_orders')
                        ->where('organisation_id', $organisationId)
                        ->where('status', 'in_production')
                        ->where('started_at', '<', $before)
                        ->get(['id', 'lot_number', 'reference']);

                    foreach ($batches as $batch) {
                        $alerts->send(StaffAlertType::BatchStuck, $organisationId, (string) $batch->id, [
                            'order_number' => (string) ($batch->lot_number ?? $batch->reference),
                        ]);
                    }
                });
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    /**
     * @return list<string>
     */
    private function tradingKitchens(): array
    {
        return Organisation::query()
            ->orderBy('id')
            ->get(['id', 'status'])
            ->filter(static fn (Organisation $organisation): bool => $organisation->status->isTrading())
            ->map(static fn (Organisation $organisation): string => (string) $organisation->getKey())
            ->values()
            ->all();
    }
}
