<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
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
 * `from` and `to` name a window of whole UTC days, both inclusive, at most
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
 * This is that answer and it is deliberately not more. A real drawer
 * reconciliation is a later table — a shift with an opening float, a closing
 * count, a named variance and its own lifecycle — and when it lands this
 * operation stays useful as the ledger it reads from rather than being replaced
 * by it. What this cannot tell anybody is whether the cash box balances, because
 * nothing on this platform has ever been told what was in it.
 *
 * ## The day boundary is UTC, and that is stated rather than assumed
 *
 * `confirmed_at` is an instant. A "day" is not, and turning one into the other
 * needs a clock this endpoint does not have: the receipt carries no branch, and
 * the order behind it may carry none either — an organisation-wide delivery zone
 * leaves `orders.branch_id` null, as the live book's real orders do. So there is
 * no branch timezone that is true of every receipt in the answer, and inventing
 * one for the rows that have it would produce a report whose two halves were
 * measured on two different clocks.
 *
 * UTC it is, matching the queue's own organisation-wide convention exactly —
 * *"unnamed, the day boundary is UTC, which is the only zone that is not a
 * guess"* — and `meta.timezone` echoes it so a screen can say which midnight it
 * is showing rather than implying the reader's own. A kitchen whose evening
 * shift runs past UTC midnight will see that evening split across two reports,
 * which is a visible, explicable fact rather than a silent misattribution; when
 * the shift table lands, a shift is the honest unit and this boundary retires
 * with it.
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
 * ## `branch_id` narrows through the **order**, not the receipt
 *
 * A receipt has no branch and should not: money is taken by a person at a till,
 * and which kitchen site cooked the food is a fact about the order. So the
 * narrowing joins `orders` — and it is the only reason that join exists, which
 * is why it is conditional. One consequence, stated because the queue screen
 * documents the same trap at length: an order with a null `branch_id` is
 * **excluded** by a branch filter. That is right for "what did the Marina site
 * take?" and wrong as a default, which is why the default is no narrowing at
 * all.
 */
final class OrderDeskCashReportController
{
    /**
     * The clock the day is measured on. See the class note — a constant rather
     * than a literal because it is echoed in `meta` and used in the boundary
     * arithmetic, and two copies that drifted would produce a report whose
     * stated timezone was not the one it was computed in.
     */
    private const string TIMEZONE = 'UTC';

    /**
     * The longest window one request may name, in days, both ends counted.
     * Long enough for any calendar month, short enough that the answer stays a
     * table somebody reads rather than an export.
     */
    private const int MAX_DAYS = 31;

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
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'], self::TIMEZONE)
            ->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'], self::TIMEZONE)
            ->startOfDay();

        // A `ValidationException`, as the calendar refuses its own oversized
        // window, so a client reads `details.fields.to` for every kind of bad `to`.
        if ($to->greaterThan($from->addDays(self::MAX_DAYS - 1))) {
            throw ValidationException::withMessages([
                'to' => 'The cash report window may not exceed '.self::MAX_DAYS.' days.',
            ]);
        }

        $branchId = isset($validated['branch_id']) ? (string) $validated['branch_id'] : null;

        $rows = $this->takings($this->locator->sellerId(), $from, $to, $branchId);

        return ApiResponse::data([
            'rows' => $rows,
            'totals' => $this->totals($rows),
            'adjustments' => $this->adjustments($this->locator->sellerId(), $from, $to, $branchId),
        ], [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'branch_id' => $branchId,
            // Echoed because the client did not choose it and cannot derive it
            // — and because a screen that did not say which midnight it was
            // showing would be implying the reader's own.
            'timezone' => self::TIMEZONE,
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
     * The day is read on the UTC clock in SQL, so it is the same day the
     * window was cut on.
     *
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
    private function takings(string $organisationId, CarbonImmutable $from, CarbonImmutable $to, ?string $branchId): array
    {
        // Assembled in SQL so the value and the sort agree, exactly as
        // `OrderDeskDriverIndexController` assembles it. `NULLIF` turns both
        // "no profile at all" and the empty string a blank pair of names would
        // produce into one null the wire can carry honestly.
        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";
        $day = "(order_payment_receipts.confirmed_at at time zone '".self::TIMEZONE."')::date";

        $query = DB::table('order_payment_receipts')
            ->selectRaw($day.' as day')
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
            ->where('order_payment_receipts.confirmed_at', '>=', $from)
            ->where('order_payment_receipts.confirmed_at', '<', $to->addDay())
            ->groupByRaw($day)
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
            ->orderByRaw($day.' asc')
            ->orderByRaw('lower('.$name.') asc nulls last')
            ->orderBy('order_payment_receipts.confirmed_by')
            ->orderBy('order_payment_receipts.method')
            ->orderBy('order_payment_receipts.currency_code');

        $this->applyBranch($query, $branchId);

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
     * completed, couriers' fees, and hand-ins that came up short.
     *
     * Beside the rows rather than netted into them, so a row stays what somebody
     * was handed and the reader can see each deduction. A settlement has no order
     * of its own, so a branch filter leaves it out rather than guess a site.
     *
     * @return list<array{day: string, kind: string, display_name: string|null, currency_code: string, entry_count: int, amount_minor_sum: int}>
     */
    private function adjustments(string $organisationId, CarbonImmutable $from, CarbonImmutable $to, ?string $branchId): array
    {
        $name = "nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '')";
        $refundDay = "(order_refunds.decided_at at time zone '".self::TIMEZONE."')::date";

        $refunds = DB::table('order_refunds')
            ->selectRaw($refundDay.' as day')
            ->addSelect(['order_refunds.kind', 'order_refunds.currency_code'])
            ->selectRaw($name.' as display_name')
            ->selectRaw('count(*) as entry_count')
            ->selectRaw('sum(order_refunds.amount_minor) as amount_minor_sum')
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'order_refunds.requested_by')
            ->where('order_refunds.organisation_id', $organisationId)
            ->where('order_refunds.status', 'completed')
            ->where('order_refunds.decided_at', '>=', $from)
            ->where('order_refunds.decided_at', '<', $to->addDay())
            ->groupByRaw($refundDay)
            ->groupBy(['order_refunds.kind', 'order_refunds.currency_code'])
            ->groupByRaw($name);

        $this->applyBranch($refunds, $branchId, 'order_refunds');

        $rows = [...$refunds->get()];

        if ($branchId === null) {
            $settlementDay = "(recorded_at at time zone '".self::TIMEZONE."')::date";
            $settlements = DB::table('cash_settlements')
                ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'cash_settlements.driver_user_id')
                ->where('cash_settlements.organisation_id', $organisationId)
                ->where('cash_settlements.recorded_at', '>=', $from)
                ->where('cash_settlements.recorded_at', '<', $to->addDay());

            foreach (['courier_fee' => 'fee_minor', 'short' => 'short_minor'] as $kind => $column) {
                $rows = [...$rows, ...(clone $settlements)
                    ->selectRaw($settlementDay.' as day')
                    ->selectRaw('? as kind', [$kind])
                    ->addSelect('cash_settlements.currency_code')
                    ->selectRaw('coalesce(cash_settlements.courier_name, '.$name.') as display_name')
                    ->selectRaw('count(*) as entry_count')
                    ->selectRaw('sum('.$column.') as amount_minor_sum')
                    ->where($column, '>', 0)
                    ->groupByRaw($settlementDay)
                    ->groupBy('cash_settlements.currency_code', 'cash_settlements.courier_name')
                    ->groupByRaw($name)
                    ->get()];
            }
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
     * Narrow to the site that cooked it.
     *
     * A join rather than a column, because a receipt has no branch — see the
     * class note — and **conditional**, because an unconditional join would make
     * every unnarrowed request pay for a table it does not read. `whereIn` over a
     * subquery rather than a `join` on `orders`: `order_payment_receipts.order_id`
     * is not unique, so a join is safe here in principle, but a subquery cannot
     * be made to fan out by a later edit and this method's whole job is to add a
     * predicate rather than a source of rows.
     *
     * The subquery carries **no organisation predicate of its own**, and does not
     * need one: it can only ever narrow. The outer query is already scoped to
     * this organisation's receipts, and a receipt points at an order of the same
     * organisation by construction, so a caller naming another kitchen's branch
     * identifier gets an empty intersection rather than a leak — the filter can
     * remove rows from the answer and can never add one.
     */
    private function applyBranch(QueryBuilder $query, ?string $branchId, string $table = 'order_payment_receipts'): void
    {
        if ($branchId === null || $branchId === '') {
            return;
        }

        $query->whereIn($table.'.order_id', function (QueryBuilder $orders) use ($branchId): void {
            $orders->select('orders.id')
                ->from('orders')
                ->where('orders.branch_id', $branchId);
        });
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
