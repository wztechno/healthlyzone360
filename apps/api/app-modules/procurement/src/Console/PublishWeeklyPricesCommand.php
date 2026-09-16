<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Console;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Procurement\Jobs\PublishWeeklyIngredientPrices;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Healthy360\Procurement\Services\WeeklyPricePublisher;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Publish overdue weekly ingredient prices by hand (PROD1).
 *
 * The same work {@see PublishWeeklyIngredientPrices}
 * does hourly, reachable from a terminal. Two occasions call for it: seeding a
 * demonstration world that needs prices before the first Monday arrives, and
 * recovering an outage longer than the publisher's backfill window without waiting
 * for the next tick.
 *
 * Idempotent, like the job: a week that already has a publication is skipped, so
 * running it on a healthy database prints zeroes and changes nothing.
 */
final class PublishWeeklyPricesCommand extends Command
{
    protected $signature = 'procurement:publish-weekly-prices
        {--org= : One organisation id or slug (defaults to every organisation that has received a delivery)}';

    protected $description = 'Publish any completed purchase week whose weekly ingredient prices are still unpublished';

    public function handle(WeeklyPricePublisher $publisher): int
    {
        $organisationIds = $this->targets();

        if ($organisationIds === []) {
            $this->components->error('No organisation matched.');

            return self::FAILURE;
        }

        $now = CarbonImmutable::now();
        $publications = 0;

        foreach ($organisationIds as $organisationId) {
            $published = $publisher->publishDueWeeks($organisationId, $now);
            $publications += count($published);

            foreach ($published as $publication) {
                $this->components->twoColumnDetail(
                    $publication->purchase_week_start_date->toDateString().' → '.$publication->purchase_week_end_date->toDateString(),
                    $this->summarise($publication),
                );
            }
        }

        $this->components->info(sprintf(
            '%d publication(s) across %d organisation(s).',
            $publications,
            count($organisationIds),
        ));

        return self::SUCCESS;
    }

    private function summarise(WeeklyPricePublication $publication): string
    {
        return sprintf(
            '%d computed, %d carried, %d unpriced',
            $publication->computed_count,
            $publication->carried_count,
            $publication->unpriced_count,
        );
    }

    /**
     * @return list<string>
     */
    private function targets(): array
    {
        $option = $this->option('org');

        if (is_string($option) && $option !== '') {
            /** @var list<string> $matched */
            $matched = Organisation::query()
                ->where(function (Builder $query) use ($option): void {
                    $query->where('slug', $option);

                    if (Str::isUuid($option)) {
                        $query->orWhere('id', $option);
                    }
                })
                ->pluck('id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            return $matched;
        }

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
