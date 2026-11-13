<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use DateTimeInterface;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * GET /catalogue/reports/kitchen-analytics — what the order book did over a
 * range of days, against the equal range just before it.
 *
 * Organisation-wide. An order belongs to the day it was placed on, read on its
 * branch's clock (UTC when it has no branch). `placed_at` and `fulfilled_at`
 * are UTC wall-clock `timestamp` columns, hence the double `AT TIME ZONE`.
 *
 * On time means fulfilled no later than the end of the requested delivery
 * window (the window's start when it has no end, end of day when there is no
 * window) on the requested date, in the branch's zone. Orders with no
 * requested date are left out of that rate rather than guessed at.
 *
 * Four aggregate statements over one filtered set of orders; no row is read
 * into PHP except the aggregates.
 */
final class KitchenAnalyticsReportController
{
    private const int MAX_DAYS = 366;

    private const array SUBSCRIPTION_SOURCES = ['subscription_capture', 'subscription_included'];

    private const string LOCAL_DATE = "((orders.placed_at AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(b.timezone, 'UTC'))::date";

    private const string DUE_AT = "((orders.requested_delivery_date + COALESCE(dw.ends_at, dw.starts_at, TIME '23:59:59'))::timestamp AT TIME ZONE COALESCE(b.timezone, 'UTC'))";

    private const string UNITS = '(SELECT COALESCE(SUM(ul.quantity), 0) FROM order_lines ul WHERE ul.order_id = orders.id)';

    private const array CHANNELS = ['subscription', 'b2b', 'pos', 'a_la_carte'];

    public function __construct(private readonly OrderLocator $locator) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'], 'UTC')->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'], 'UTC')->startOfDay();
        $length = (int) $from->diffInDays($to) + 1;

        if ($length > self::MAX_DAYS) {
            throw ValidationException::withMessages([
                'to' => 'The range may not exceed '.self::MAX_DAYS.' days.',
            ]);
        }

        $organisationId = $this->locator->sellerId();
        $previousFrom = $from->subDays($length);
        $live = fn (Builder $query): Builder => $query->where('o.status', '!=', 'cancelled');
        $current = fn (): Builder => $live(DB::query()->fromSub($this->orders($organisationId, $from, $to), 'o'));

        $totals = DB::query()
            ->fromSub($this->orders($organisationId, $previousFrom, $to), 'o')
            ->selectRaw('(o.local_date >= ?) as is_current', [$from->toDateString()])
            ->selectRaw("count(*) filter (where o.status <> 'cancelled') as orders")
            ->selectRaw("coalesce(sum(o.units) filter (where o.status <> 'cancelled'), 0) as units")
            ->selectRaw("count(*) filter (where o.status = 'cancelled') as cancelled")
            ->selectRaw("count(*) filter (where o.status = 'fulfilled') as fulfilled")
            ->selectRaw("count(*) filter (where o.status in ('placed', 'confirmed')) as open")
            ->selectRaw("count(*) filter (where o.status = 'fulfilled' and o.requested_delivery_date is not null) as fulfilled_with_due")
            ->selectRaw("count(*) filter (where o.status = 'fulfilled' and (o.fulfilled_at AT TIME ZONE 'UTC') <= o.due_at) as on_time")
            ->selectRaw("round(avg(extract(epoch from o.fulfilled_at - o.placed_at) / 60) filter (where o.status = 'fulfilled')) as avg_lead_minutes")
            ->groupByRaw('1')
            ->get()
            ->keyBy(fn (object $row): string => $row->is_current ? 'current' : 'previous');

        $days = $current()
            ->selectRaw('o.local_date, count(*) as orders, sum(o.units) as units')
            ->groupBy('o.local_date')
            ->get()
            ->keyBy(fn (object $row): string => (string) $row->local_date);

        $channels = $current()
            ->selectRaw('o.channel, count(*) as orders, sum(o.units) as units')
            ->groupBy('o.channel')
            ->get()
            ->keyBy('channel');

        $items = $current()
            ->join('order_lines as ol', 'ol.order_id', '=', 'o.id')
            ->leftJoin('catalogue_items as ci', 'ci.id', '=', 'ol.catalogue_item_id')
            ->select(['ol.catalogue_item_id', 'ci.item_type'])
            ->selectRaw('(array_agg(ol.name_en order by o.placed_at desc))[1] as name_en')
            ->selectRaw('(array_agg(ol.name_ar order by o.placed_at desc))[1] as name_ar')
            ->selectRaw('count(distinct o.id) as orders, sum(ol.quantity) as units, max(o.placed_at) as last_ordered_at')
            ->groupBy('ol.catalogue_item_id', 'ci.item_type')
            ->orderByDesc('units')
            ->orderBy('name_en')
            ->orderBy('ol.catalogue_item_id')
            ->limit(50)
            ->get();

        return ApiResponse::data([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'current' => $this->totals($totals->get('current')),
            'previous' => $this->totals($totals->get('previous')),
            'days' => array_map(fn (DateTimeInterface $day): array => [
                'date' => $day->format('Y-m-d'),
                'orders' => (int) ($days->get($day->format('Y-m-d'))->orders ?? 0),
                'units' => (float) ($days->get($day->format('Y-m-d'))->units ?? 0),
            ], CarbonPeriod::create($from, $to)->toArray()),
            'channels' => array_map(fn (string $key): array => [
                'key' => $key,
                'orders' => (int) ($channels->get($key)->orders ?? 0),
                'units' => (float) ($channels->get($key)->units ?? 0),
            ], self::CHANNELS),
            'items' => $items->map(fn (object $row): array => [
                'catalogue_item_id' => (string) $row->catalogue_item_id,
                'name_en' => (string) $row->name_en,
                'name_ar' => $row->name_ar === null ? null : (string) $row->name_ar,
                'item_type' => $row->item_type === null ? null : (string) $row->item_type,
                'orders' => (int) $row->orders,
                'units' => (float) $row->units,
                'last_ordered_at' => CarbonImmutable::parse((string) $row->last_ordered_at, 'UTC')->toIso8601ZuluString(),
            ])->all(),
        ]);
    }

    /**
     * Every order of the organisation placed on a local day in the range, with
     * the figures the aggregates read already derived.
     */
    private function orders(string $organisationId, CarbonImmutable $from, CarbonImmutable $to): Builder
    {
        $sources = implode(', ', array_fill(0, count(self::SUBSCRIPTION_SOURCES), '?'));

        return DB::table('orders')
            ->leftJoin('organisation_branches as b', 'b.id', '=', 'orders.branch_id')
            ->leftJoin('delivery_windows as dw', function (JoinClause $join): void {
                $join->on('dw.organisation_id', '=', 'orders.organisation_id')
                    ->on('dw.code', '=', 'orders.delivery_window_code');
            })
            ->leftJoin('sales_channels as sc', 'sc.id', '=', 'orders.sales_channel_id')
            ->select(['orders.id', 'orders.status', 'orders.placed_at', 'orders.fulfilled_at', 'orders.requested_delivery_date'])
            ->selectRaw(self::LOCAL_DATE.' as local_date')
            ->selectRaw(self::DUE_AT.' as due_at')
            ->selectRaw(self::UNITS.' as units')
            // First match wins: a subscription line, then a B2B agreement or
            // channel, then the till; everything else is à la carte.
            ->selectRaw("CASE
                WHEN EXISTS (SELECT 1 FROM order_lines sl WHERE sl.order_id = orders.id AND sl.price_source IN ({$sources})) THEN 'subscription'
                WHEN orders.b2b_agreement_id IS NOT NULL OR sc.channel_kind IN ('b2b', 'corporate') THEN 'b2b'
                WHEN sc.channel_kind = 'pos' THEN 'pos'
                ELSE 'a_la_carte'
            END as channel", self::SUBSCRIPTION_SOURCES)
            ->where('orders.organisation_id', $organisationId)
            ->whereRaw(self::LOCAL_DATE.' between ? and ?', [$from->toDateString(), $to->toDateString()]);
    }

    /**
     * @return array{orders: int, units: float, cancelled: int, fulfilled: int, open: int, fulfilled_with_due: int, on_time: int, avg_lead_minutes: int|null}
     */
    private function totals(?object $row): array
    {
        return [
            'orders' => (int) ($row->orders ?? 0),
            'units' => (float) ($row->units ?? 0),
            'cancelled' => (int) ($row->cancelled ?? 0),
            'fulfilled' => (int) ($row->fulfilled ?? 0),
            'open' => (int) ($row->open ?? 0),
            'fulfilled_with_due' => (int) ($row->fulfilled_with_due ?? 0),
            'on_time' => (int) ($row->on_time ?? 0),
            'avg_lead_minutes' => isset($row->avg_lead_minutes) ? (int) $row->avg_lead_minutes : null,
        ];
    }
}
