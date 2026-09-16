<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Jobs;

use Carbon\CarbonImmutable;
use Healthy360\Procurement\Services\WeeklyPricePublisher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Publish every kitchen's overdue weekly ingredient prices (PROD1).
 *
 * ## Hourly, with the Monday test inside
 *
 * The requirement says Monday morning, and the schedule entry is nevertheless
 * hourly. Two reasons, and both are about the platform rather than the arithmetic:
 *
 * 1. **Nine launch markets, one cron.** Monday 06:00 is a different UTC instant in
 *    Beirut and in Dubai, and a single cron expression can only name one of them.
 *    Asking each organisation "has your Monday arrived, and is your week still
 *    unpublished?" makes one entry serve all nine — the same shape
 *    `GenerateSubscriptionDeliveries` already runs on.
 * 2. **A missed Monday is not a lost week.** The publisher walks the last
 *    {@see WeeklyPricePublisher::BACKFILL_WEEKS} completed weeks oldest-first and
 *    publishes whatever is missing, so an outage on the day costs a delay rather
 *    than a gap. A Monday-only guard would have skipped the week silently, and a
 *    kitchen would have found out when a technical sheet quietly costed itself at
 *    a fortnight-old price.
 *
 * Re-running the job costs one indexed existence check per organisation per
 * missing week, which is what makes hourly affordable.
 *
 * ## Only organisations that buy things
 *
 * Driven from the distinct `organisation_id` values in `goods_receipts`: an
 * organisation that has never received a delivery has no purchases to average, and
 * iterating every tenant to discover that would make the job's cost a function of
 * the platform's size rather than of the work there is to do.
 *
 * Failures are logged per organisation and do not abort the run. One kitchen with
 * a stranded unit must not stop the other eight markets from getting their prices.
 */
final class PublishWeeklyIngredientPrices implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(WeeklyPricePublisher $publisher): void
    {
        $now = CarbonImmutable::now();
        $published = 0;
        $failed = 0;

        foreach ($this->purchasingOrganisationIds() as $organisationId) {
            try {
                $published += count($publisher->publishDueWeeks($organisationId, $now));
            } catch (\Throwable $exception) {
                $failed++;

                Log::error('Weekly ingredient price publication failed for one organisation.', [
                    'organisation_id' => $organisationId,
                    'exception' => $exception->getMessage(),
                ]);
            }
        }

        if ($published > 0 || $failed > 0) {
            Log::info('Weekly ingredient prices published.', [
                'publications' => $published,
                'organisations_failed' => $failed,
            ]);
        }
    }

    /**
     * @return list<string>
     */
    private function purchasingOrganisationIds(): array
    {
        /** @var list<string> $ids */
        $ids = DB::table('goods_receipts')
            ->distinct()
            ->orderBy('organisation_id')
            ->pluck('organisation_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        return $ids;
    }
}
