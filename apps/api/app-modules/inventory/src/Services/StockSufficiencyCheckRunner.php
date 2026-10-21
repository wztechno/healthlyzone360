<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockSufficiencyCheck;
use Illuminate\Support\Facades\Log;

/**
 * The weekly stock check: for every branch that keeps a shelf, the buy list
 * for the days ahead, and a record of what it was short of.
 *
 * "Keeps a shelf" is a branch with at least one `stock_levels` row. A kitchen
 * that tracks no stock would otherwise be told every week that it is short of
 * everything, and a check that is always red is a check nobody reads.
 *
 * The numbers are exactly the requirements screen's — the same
 * {@see RequirementForecast} over the same window — so the check and the
 * screen it links to can never disagree about what was short. Holes (a meal
 * with no recipe, a menu never written) are counted, not folded into the
 * shortfall, for the reason the forecast gives.
 *
 * Every read in the forecast is organisation-explicit and `withoutTenancy()`,
 * which is what lets this run from the scheduler with no request context.
 */
final readonly class StockSufficiencyCheckRunner
{
    /** The days a weekly check looks ahead, today included. */
    public const int WINDOW_DAYS = 7;

    public function __construct(private RequirementForecast $forecast) {}

    /**
     * @return int the number of branches checked
     */
    public function run(CarbonImmutable $now, int $days = self::WINDOW_DAYS): int
    {
        $from = $now->startOfDay();
        $to = $from->addDays(max(1, $days) - 1);

        $shelves = StockLevel::withoutTenancy()
            ->select(['organisation_id', 'branch_id'])
            ->distinct()
            ->get();

        foreach ($shelves as $shelf) {
            $this->check((string) $shelf->organisation_id, (string) $shelf->branch_id, $from, $to, $now);
        }

        Log::info('Weekly stock sufficiency check ran.', ['branches' => $shelves->count(), 'from' => $from->toDateString(), 'to' => $to->toDateString()]);

        return $shelves->count();
    }

    public function check(string $organisationId, string $branchId, CarbonImmutable $from, CarbonImmutable $to, CarbonImmutable $now): StockSufficiencyCheck
    {
        $result = $this->forecast->forOrganisation($organisationId, $from, $to, $branchId);

        $short = array_values(array_filter(
            $result->requirements,
            static fn (array $row): bool => bccomp((string) $row['short'], '0', 4) > 0,
        ));

        $check = new StockSufficiencyCheck;
        $check->organisation_id = $organisationId;
        $check->branch_id = $branchId;
        $check->window_from = $from;
        $check->window_to = $to;
        $check->checked_at = $now;
        $check->requirement_count = count($result->requirements);
        $check->short_count = count($short);
        $check->not_computable_days = $result->notComputableDays;
        $check->shortfalls = array_map(static fn (array $row): array => [
            'stock_item_id' => $row['stock_item_id'],
            'code' => $row['code'],
            'name_en' => $row['name_en'],
            'unit_code' => $row['unit_code'],
            'required' => $row['required'],
            'available' => $row['available'],
            'short' => $row['short'],
            'suggested_buy' => $row['suggested_buy'],
        ], $short);
        $check->save();

        return $check;
    }
}
