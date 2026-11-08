<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\OrderDesk\Services\LocalDay;
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
 * GET /api/v1/catalogue/order-desk/cash-report — who took what, day by day.
 *
 * ## A range of days, still read one day at a time
 *
 * `from` and `to` name a window of whole local days, both inclusive, at most
 * {@see self::MAX_DAYS} long. The day is part of every row's key, so a week is
 * seven days of rows rather than one row summing Monday and Tuesday — each day
 * can still be stood next to that day's cash box. `totals` sum the whole window
 * per method and currency, which is legal for the same reason they always were:
 * it never crosses a currency.
 *
 * ## This is the till-shift mitigation, and it says so
 *
 * The desk takes cash. `order_payment_receipts` records every note that crossed
 * the counter, who says it arrived and when — and the platform has **no shift
 * table**: nothing opens a drawer with a float, nothing closes it against a
 * count, nothing reconciles the difference. That gap was accepted knowingly when
 * receipts landed, on the condition that the money at least be *attributable*:
 * a manager must be able to ask "what did each agent take yesterday?" and get an
 * answer they can stand a cash box next to.
 *
 * This is that answer and it is deliberately not more. The drawer reconciliation
 * is `DailyCloses`: an opening float, a closing count and a named variance, read
 * from these same receipts. This report stays what it was, and cannot tell anybody
 * whether the cash box balanced.
 *
 * ## The day is the kitchen's local day
 *
 * `confirmed_at` is an instant and a day is not. The whole report is read on one
 * clock, chosen per request by {@see LocalDay}: the named branch's timezone, or
 * with no branch the organisation's, the clock `DailyCloses` uses (owner, 3 Nov).
 * A receipt at 23:30 in Beirut is that Beirut date's money, not the next UTC
 * day's. `meta.timezone` echoes the zone, so a client can say which midnight it
 * is showing rather than implying the reader's own. With All branches the days are
 * the organisation's, so where a branch keeps a different clock its own report and
 * All split the same money at different midnights (owner ruling: the branch's day
 * with a branch, the organisation's without).
 *
 * The zone goes into SQL as a literal, which is safe only because `LocalDay`
 * returns a `DateTimeZone::listIdentifiers()` entry. A bound parameter would not
 * do: PostgreSQL reads `at time zone $1` in the select list and `$5` in the
 * group by as two different expressions.
 *
 * ## Grouped by three things, summed within groups only
 *
 * `(confirmed_by, method, currency_code)` — the person, how the money turned up,
 * and what money it was. The third is not decoration. Sums are legal **inside** a
 * group because every receipt in one is the same unit of the same currency; the
 * moment a group spanned two currencies the sum would be a number in no currency
 * at all. So the currency is part of the grouping key and never an attribute of
 * the group, which makes cross-currency addition unrepresentable here rather
 * than merely discouraged. A kitchen taking dollars and dirhams sees two rows
 * for one agent's cash, and two totals, which is the truth.
 *
 * `totals` is the same arithmetic one level up — per `(method, currency_code)`,
 * across the agents — and it is computed from the rows rather than by a second
 * query, so the two can never disagree. There is deliberately **no grand
 * total**: it would have to add currencies.
 *
 * ## `order.manage_organisation`
 *
 * The drivers endpoint's code, and the same seat: this is a manager's
 * reconciliation of their agents' takings, not an agent's view of their own
 * work. It is a statement about *people* — Sara took four hundred, Omar took
 * ninety — which is a different disclosure from the order book, and
 * `order.view_organisation` is held by everybody who works a queue. A new code
 * was considered and rejected: an authority to read the day's cash that could be
 * held without the authority to move an order is not a seat anybody occupies,
 * and the permission registry is not improved by codes nobody grants.
 *
 * ## `branch_id` names a till
 *
 * One till per branch, resolved by {@see TillBranches} exactly as the daily close
 * resolves it, so a branch's report and its close read the same money. Receipts
 * and refunds belong to their order's till: the order's branch, else its delivery
 * zone's, else the kitchen's first branch. A hand-in carries its own branch, and
 * one from before tills were per branch counts as the first branch's.
 * `meta.branches` lists the tills, first branch first. A branch that is not one
 * of this kitchen's is refused rather than answered empty.
 */
final class OrderDeskCashReportController
{
    /**
     * The longest window one request may name, in days, both ends counted.
     * Long enough for any calendar month, short enough that the answer stays a
     * table somebody reads rather than an export.
     */
    private const int MAX_DAYS = 31;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly LocalDay $localDay,
        private readonly TillBranches $tills,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $organisationId = $this->locator->sellerId();
        $branchId = isset($validated['branch_id']) ? strtolower((string) $validated['branch_id']) : null;
        $branches = $this->tills->all($organisationId);

        if ($branchId !== null && ! in_array($branchId, array_column($branches, 'id'), true)) {
            throw ValidationException::withMessages([
                'branch_id' => 'This is not a branch of this kitchen.',
            ]);
        }

        $zone = $this->localDay->zone($organisationId, $branchId);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'], $zone)
            ->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'], $zone)
            ->startOfDay();

        // A `ValidationException`, as the calendar refuses its own oversized
        // window, so a client reads `details.fields.to` for every kind of bad `to`.
        if ($to->greaterThan($from->addDays(self::MAX_DAYS - 1))) {
            throw ValidationException::withMessages([
                'to' => 'The cash report window may not exceed '.self::MAX_DAYS.' days.',
            ]);
        }

        // Converted to UTC before binding: a bound Carbon is formatted without its
        // offset, so a Beirut midnight would be read as a UTC one. The end is the
        // local midnight after `to`, which is 23 or 25 hours away on a DST day.
        $window = [
            'zone' => $zone,
            'start' => $from->utc(),
            'end' => $to->addDay()->utc(),
            'first' => $branches[0]['id'] ?? null,
            'branch' => $branchId,
        ];

        $rows = $this->takings($organisationId, $window);

        return ApiResponse::data([
            'rows' => $rows,
            'totals' => $this->totals($rows),
            'adjustments' => $this->adjustments($organisationId, $window),
        ], [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'branch_id' => $branchId,
            // Echoed because the client did not choose it and cannot derive it
            // — so a client can say which midnight it was cut on rather than
            // imply the reader's own.
            'timezone' => $zone,
            'branches' => $branches,
            'count' => count($rows),
        ]);
    }

    /**
     * The window's receipts, grouped by day, who took them, how, and in what.
     *
     * **One statement, grouped in SQL.** The alternative — read the day's
     * receipts and group them in PHP — would pull every row of a busy counter's
     * Saturday across the wire to produce a dozen numbers, and the index this
     * walks (`organisation_id, confirmed_at`) exists precisely so the database
     * can answer it without doing that.
     *
     * The organisation predicate is written here rather than inherited, because
     * `OrderPaymentReceipt` carries no ambient scope — the same explicit filter
     * `OrderDeskQueue::receivedByOrder()` argues for, and here it is the *whole*
     * isolation: there is no second organisation column in the answer to catch a
     * mistake with.
     *
     * The window is **half-open** — `>= midnight of from` and `< midnight after
     * to` — rather than a `whereBetween` on two instants. A closed upper bound at
     * `23:59:59.999999` is a boundary somebody eventually has to reason about
     * with microseconds, and a receipt confirmed in the last tick of the day
     * would sit in a report on neither side of it.
     *
     * The name is joined from `user_profiles`, not from `users`: `users` carries
     * an email and, deliberately, no name at all — person data lives on the
     * profile. `LEFT`, because a user row can exist before its profile does and
     * an agent who never completed one still took the money; refusing to list
     * their takings would be losing cash from the report to protect a null. The
     * join cannot fan out (`user_profiles.user_id` is unique), which is what
     * makes it safe to group across it.
     *
     * The day is read in SQL on the zone the window was cut on, so a receipt
     * lands on the same local day that let it into the window.
     *
     * @param  array{zone: string, start: CarbonImmutable, end: CarbonImmutable, first: string|null, branch: string|null}  $window
     * @return list<array{
     *     day: string,
     *     confirmed_by: string,
     *     display_name: string|null,
     *     method: string,
     *     currency_code: string,
     *     receipt_count: int,
     *     amount_minor_sum: int
     * }>
     */
    private function takings(string $organisationId, array $window): array
    {
        // Assembled in SQL so the value and the sort agree, exactly as
        // `OrderDeskDriverIndexController` assembles it. `NULLIF` turns both
        // "no profile at all" and the empty string a blank pair of names would
        // produce into one null the wire can carry honestly.
        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";
        // The zone is a binding, so the day is grouped and sorted by its alias:
        // the same expression twice would be two parameters PostgreSQL cannot match.
        $query = DB::table('order_payment_receipts')
            ->selectRaw('(order_payment_receipts.confirmed_at at time zone ?)::date as day', [$window['zone']])
            ->addSelect([
                'order_payment_receipts.confirmed_by',
                'order_payment_receipts.method',
                'order_payment_receipts.currency_code',
            ])
            ->selectRaw($name.' as display_name')
            ->selectRaw('count(*) as receipt_count')
            ->selectRaw('sum(order_payment_receipts.amount_minor) as amount_minor_sum')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'order_payment_receipts.confirmed_by')
            ->where('order_payment_receipts.organisation_id', $organisationId)
            ->where('order_payment_receipts.confirmed_at', '>=', $window['start'])
            ->where('order_payment_receipts.confirmed_at', '<', $window['end'])
            ->groupBy('day')
            ->groupBy([
                'order_payment_receipts.confirmed_by',
                'order_payment_receipts.method',
                'order_payment_receipts.currency_code',
            ])
            // The assembled name is in the select list, so it has to be grouped
            // by too. It is functionally dependent on `confirmed_by` and adds no
            // rows; PostgreSQL cannot prove that across a join, so it is stated.
            ->groupByRaw($name)
            // Day by day, then named agents first, nameless last, then a total
            // order over the two remaining key columns so that two identical
            // requests cannot return the same figures in two orders.
            ->orderBy('day')
            ->orderByRaw('lower('.$name.') asc nulls last')
            ->orderBy('order_payment_receipts.confirmed_by')
            ->orderBy('order_payment_receipts.method')
            ->orderBy('order_payment_receipts.currency_code');

        $this->applyTill($query, TillBranches::orderIn('order_payment_receipts.order_id'), $window);

        $rows = [];

        foreach ($query->get() as $row) {
            $displayName = $row->display_name;

            $rows[] = [
                'day' => (string) $row->day,
                'confirmed_by' => (string) $row->confirmed_by,
                'display_name' => is_string($displayName) && $displayName !== '' ? $displayName : null,
                'method' => (string) $row->method,
                'currency_code' => (string) $row->currency_code,
                'receipt_count' => (int) $row->receipt_count,
                'amount_minor_sum' => (int) $row->amount_minor_sum,
            ];
        }

        return $rows;
    }

    /**
     * What came off those takings in the window: refunds and corrections that
     * completed, couriers' fees, prepaid runs' courier fees the kitchen paid, and
     * hand-ins that came up short.
     *
     * Beside the rows rather than netted into them, so a row stays what somebody
     * was handed and the reader can see each deduction. A hand-in is narrowed by
     * its own branch, the till it went into.
     *
     * @param  array{zone: string, start: CarbonImmutable, end: CarbonImmutable, first: string|null, branch: string|null}  $window
     * @return list<array{day: string, kind: string, display_name: string|null, currency_code: string, entry_count: int, amount_minor_sum: int}>
     */
    private function adjustments(string $organisationId, array $window): array
    {
        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";
        $refunds = DB::table('order_refunds')
            ->selectRaw('(order_refunds.decided_at at time zone ?)::date as day', [$window['zone']])
            ->addSelect(['order_refunds.kind', 'order_refunds.currency_code'])
            ->selectRaw($name.' as display_name')
            ->selectRaw('count(*) as entry_count')
            ->selectRaw('sum(order_refunds.amount_minor) as amount_minor_sum')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'order_refunds.requested_by')
            ->where('order_refunds.organisation_id', $organisationId)
            ->where('order_refunds.status', 'completed')
            ->where('order_refunds.decided_at', '>=', $window['start'])
            ->where('order_refunds.decided_at', '<', $window['end'])
            ->groupBy('day')
            ->groupBy(['order_refunds.kind', 'order_refunds.currency_code'])
            ->groupByRaw($name);

        $this->applyTill($refunds, TillBranches::orderIn('order_refunds.order_id'), $window);

        $rows = [...$refunds->get()];

        $settlements = DB::table('cash_settlements')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'cash_settlements.driver_user_id')
            ->where('cash_settlements.organisation_id', $organisationId)
            ->where('cash_settlements.recorded_at', '>=', $window['start'])
            ->where('cash_settlements.recorded_at', '<', $window['end']);

        $this->applyTill($settlements, TillBranches::rowIn('cash_settlements.branch_id'), $window);

        // `courier_expense` is a prepaid run's fee: the kitchen paid it, and it was
        // never part of a hand-in, so it is listed beside the fees that were.
        foreach (['courier_fee' => 'fee_minor', 'courier_expense' => 'expense_minor', 'short' => 'short_minor'] as $kind => $column) {
            $rows = [...$rows, ...(clone $settlements)
                ->selectRaw('(cash_settlements.recorded_at at time zone ?)::date as day', [$window['zone']])
                ->selectRaw('? as kind', [$kind])
                ->addSelect('cash_settlements.currency_code')
                ->selectRaw('coalesce(cash_settlements.courier_name, '.$name.') as display_name')
                ->selectRaw('count(*) as entry_count')
                ->selectRaw('sum(cash_settlements.'.$column.') as amount_minor_sum')
                ->where('cash_settlements.'.$column, '>', 0)
                ->groupBy('day')
                ->groupBy('cash_settlements.currency_code', 'cash_settlements.courier_name')
                ->groupByRaw($name)
                ->get()];
        }

        $adjustments = array_map(static fn (object $row): array => [
            'day' => (string) $row->day,
            'kind' => (string) $row->kind,
            'display_name' => is_string($row->display_name) && $row->display_name !== '' ? $row->display_name : null,
            'currency_code' => (string) $row->currency_code,
            'entry_count' => (int) $row->entry_count,
            'amount_minor_sum' => (int) $row->amount_minor_sum,
        ], $rows);

        usort($adjustments, static fn (array $left, array $right): int => [$left['day'], $left['kind'], (string) $left['display_name']] <=> [$right['day'], $right['kind'], (string) $right['display_name']]);

        return $adjustments;
    }

    /**
     * Narrow to one till, when one is named. `$predicate` is a {@see TillBranches}
     * clause, which binds the first branch and then the till's branch.
     *
     * @param  literal-string  $predicate
     * @param  array{zone: string, start: CarbonImmutable, end: CarbonImmutable, first: string|null, branch: string|null}  $window
     */
    private function applyTill(QueryBuilder $query, string $predicate, array $window): void
    {
        if ($window['branch'] !== null) {
            $query->whereRaw($predicate, [$window['first'], $window['branch']]);
        }
    }

    /**
     * The same money one level up: per method and currency, across the agents.
     *
     * Derived from the rows rather than asked for separately, so the totals
     * cannot disagree with the table above them — two queries against a table
     * somebody is writing to would eventually answer two different Saturdays.
     *
     * Keyed by `(method, currency_code)` and never by method alone. Adding a
     * dirham row to a dollar row would produce a number in no currency, and the
     * only reliable defence against that is a data structure in which it cannot
     * be written.
     *
     * Ordered by first appearance, which follows the rows' own order and is
     * therefore as deterministic as they are.
     *
     * @param  list<array{
     *     day: string,
     *     confirmed_by: string,
     *     display_name: string|null,
     *     method: string,
     *     currency_code: string,
     *     receipt_count: int,
     *     amount_minor_sum: int
     * }>  $rows
     * @return list<array{
     *     method: string,
     *     currency_code: string,
     *     receipt_count: int,
     *     amount_minor_sum: int
     * }>
     */
    private function totals(array $rows): array
    {
        $totals = [];

        foreach ($rows as $row) {
            $key = $row['method'].'|'.$row['currency_code'];

            $totals[$key] ??= [
                'method' => $row['method'],
                'currency_code' => $row['currency_code'],
                'receipt_count' => 0,
                'amount_minor_sum' => 0,
            ];

            $totals[$key]['receipt_count'] += $row['receipt_count'];
            $totals[$key]['amount_minor_sum'] += $row['amount_minor_sum'];
        }

        return array_values($totals);
    }
}
