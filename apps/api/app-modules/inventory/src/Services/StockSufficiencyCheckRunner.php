<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use App\Services\NoticeRecipients;
use Carbon\CarbonImmutable;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockSufficiencyCheck;
use Healthy360\Support\Mail\NoticeMessage;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

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

    /** How many short items the mail names before it says "and N more". */
    private const int MAILED = 10;

    public function __construct(
        private RequirementForecast $forecast,
        private NoticeRecipients $recipients,
    ) {}

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

        if ($check->short_count > 0) {
            $this->mail($check);
        }

        return $check;
    }

    /**
     * Tell the kitchen (2026-10-21): the members who may read the stock get the
     * shortfalls and a link to the buy list. Only when something is short — a
     * weekly "all fine" mail is the kind people learn to delete unread.
     */
    private function mail(StockSufficiencyCheck $check): void
    {
        $url = rtrim((string) config('app.frontend_url'), '/').'/kitchen/order-desk/requirements';

        foreach ($this->recipients->holding($check->organisation_id, 'inventory.view_organisation') as $recipient) {
            $locale = $recipient['locale'];
            $lines = array_map(static fn (array $row): string => __('notices.stock.line', [
                'name' => $row['name_en'],
                'short' => rtrim(rtrim((string) $row['short'], '0'), '.'),
                'buy' => rtrim(rtrim((string) $row['suggested_buy'], '0'), '.'),
                'unit' => $row['unit_code'] ?? '',
            ], $locale), array_slice($check->shortfalls, 0, self::MAILED));

            if (count($check->shortfalls) > self::MAILED) {
                $lines[] = __('notices.stock.more', ['count' => count($check->shortfalls) - self::MAILED], $locale);
            }

            if ($check->not_computable_days > 0) {
                $lines[] = trans_choice('notices.stock.holes', $check->not_computable_days, ['count' => $check->not_computable_days], $locale);
            }

            try {
                Mail::to($recipient['email'])->queue(new NoticeMessage(
                    'stock_shortfall',
                    trans_choice('notices.stock.heading', $check->short_count, [
                        'count' => $check->short_count,
                        'from' => $check->window_from->toDateString(),
                        'to' => $check->window_to->toDateString(),
                    ], $locale),
                    array_values($lines),
                    __('notices.stock.action', [], $locale),
                    $url,
                    $locale,
                ));
            } catch (Throwable $e) {
                report($e);
            }
        }
    }
}
