<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\OrderDesk\Services\DailyCloses;
use Healthy360\Orders\OrderDesk\Services\LocalDay;
use Healthy360\Orders\OrderDesk\Services\OrderDeskQueue;
use Healthy360\Orders\OrderDesk\Services\TillBranches;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/order-desk/today — the kitchen home's Today card.
 *
 * Four things a manager glances at (owner, 3 Nov): sales and orders, cash to
 * collect, late and past-due orders, and cancellations. Nothing here is new
 * arithmetic; each figure is read the way the screen it links to reads it.
 *
 * - **Day:** the local day, chosen as the cash report chooses it ({@see LocalDay}).
 *   Its bounds are converted to UTC before binding.
 * - **Branch:** a till, as `TillBranches` resolves it, so the card and the cash
 *   report agree. Late and past due narrow to the same till, so a branchless
 *   late order is late in exactly one branch.
 * - **Sales:** orders placed today and not cancelled, per currency.
 * - **Cash:** `cash_expected` is what each open till should hold now, from
 *   {@see DailyCloses::open()}: the float plus counter cash and hand-ins, less
 *   cash refunds, as the close screen pre-fills it. `cash_counted` is each till's
 *   last count today, as {@see DailyCloses::totals()} reads it. Both cash
 *   figures run on the organisation's clock, the one `DailyCloses` keeps; the
 *   rest of the card uses the branch's day when a branch is named. They differ
 *   only for a branch in another timezone from the kitchen.
 * - **Cancellations:** cancelled today, by disposition. No disposition is `other`.
 *
 * Money stays per currency: no figure adds two.
 */
final class OrderDeskTodayController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly LocalDay $localDay,
        private readonly TillBranches $tills,
        private readonly DailyCloses $closes,
        private readonly OrderDeskQueue $queue,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate(['branch_id' => ['nullable', 'uuid']]);

        $organisationId = $this->locator->sellerId();
        $branchId = isset($validated['branch_id']) ? strtolower((string) $validated['branch_id']) : null;
        $branches = $this->tills->all($organisationId);
        $first = $branches[0]['id'] ?? null;

        if ($branchId !== null && ! in_array($branchId, array_column($branches, 'id'), true)) {
            throw ValidationException::withMessages(['branch_id' => 'This is not a branch of this kitchen.']);
        }

        $zone = $this->localDay->zone($organisationId, $branchId);
        $now = CarbonImmutable::now($zone);
        $start = $now->startOfDay();
        $end = $start->addDay();
        $window = [$start->utc(), $end->utc()];

        $orders = static function () use ($organisationId, $branchId, $first): QueryBuilder {
            $query = DB::table('orders')->where('orders.organisation_id', $organisationId);

            if ($branchId !== null) {
                $query->whereRaw(TillBranches::ofOrder().' is not distinct from cast(? as uuid)', [$first, $branchId]);
            }

            return $query;
        };

        $sales = $orders()
            ->where('status', '<>', OrderStatus::Cancelled->value)
            ->where('placed_at', '>=', $window[0])
            ->where('placed_at', '<', $window[1])
            ->groupBy('currency_code')
            ->orderBy('currency_code')
            ->select('currency_code')
            ->selectRaw('count(*) as order_count, sum(total_minor) as amount_minor')
            ->get();

        $cancelled = $orders()
            ->where('status', OrderStatus::Cancelled->value)
            ->where('cancelled_at', '>=', $window[0])
            ->where('cancelled_at', '<', $window[1])
            ->groupBy('cancellation_disposition')
            ->select('cancellation_disposition')
            ->selectRaw('count(*) as order_count')
            ->pluck('order_count', 'cancellation_disposition');

        $due = $this->queue->dueCountsFor($organisationId, $branchId, $first, $now);

        return ApiResponse::data([
            'day' => $start->toDateString(),
            'timezone' => $zone,
            'sales' => $sales->map(static fn (object $row): array => [
                'currency_code' => (string) $row->currency_code,
                'amount_minor' => (int) $row->amount_minor,
            ])->values()->all(),
            'orders' => (int) $sales->sum('order_count'),
            'cash_expected' => $this->cashExpected($organisationId, $branchId),
            'cash_counted' => $this->cashCounted($organisationId, $branchId, $first),
            'overdue' => $due['overdue_count'],
            'past_due' => $due['past_due_count'],
            'cancelled' => [
                'returned' => (int) ($cancelled['returned'] ?? 0),
                'wasted' => (int) ($cancelled['wasted'] ?? 0),
                'other' => (int) ($cancelled[''] ?? 0),
            ],
        ], ['branch_id' => $branchId]);
    }

    /**
     * What the open tills should hold now, per currency.
     *
     * @return list<array{currency_code: string, amount_minor: int}>
     */
    private function cashExpected(string $organisationId, ?string $branchId): array
    {
        $sums = [];

        foreach ($this->closes->open($organisationId)['open'] as $till) {
            if ($branchId !== null && $till['branch_id'] !== $branchId) {
                continue;
            }

            $sums[$till['currency_code']] = ($sums[$till['currency_code']] ?? 0)
                + $till['suggested_float_minor'] + $till['counter_cash_minor'] + $till['handed_in_minor'] - $till['cash_refunds_minor'];
        }

        ksort($sums);

        return array_map(static fn (string $code, int $amount): array => ['currency_code' => $code, 'amount_minor' => $amount], array_keys($sums), array_values($sums));
    }

    /**
     * Each till's last count today, summed per currency. Today is the close's own
     * business date, which `DailyCloses` reads on the organisation's clock.
     *
     * @return list<array{currency_code: string, amount_minor: int}>
     */
    private function cashCounted(string $organisationId, ?string $branchId, ?string $first): array
    {
        $today = CarbonImmutable::now($this->localDay->zone($organisationId))->toDateString();

        $closes = DB::table('daily_closes')
            ->where('organisation_id', $organisationId)
            ->where('business_date', $today)
            ->select(['currency_code', 'counted_minor'])
            ->selectRaw('row_number() over (partition by currency_code, branch_id order by closed_at desc) = 1 as is_last');

        if ($branchId !== null) {
            $closes->whereRaw(TillBranches::rowIn('branch_id'), [$first, $branchId]);
        }

        return DB::query()->fromSub($closes, 'closes')
            ->where('is_last', true)
            ->groupBy('currency_code')
            ->orderBy('currency_code')
            ->select('currency_code')
            ->selectRaw('sum(counted_minor) as amount_minor')
            ->get()
            ->map(static fn (object $row): array => ['currency_code' => (string) $row->currency_code, 'amount_minor' => (int) $row->amount_minor])
            ->values()
            ->all();
    }
}
