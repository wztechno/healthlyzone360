<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Contracts\SubscriptionOutlook;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;

/**
 * What leaves this kitchen on each day of a window, counted three ways that are
 * never added together.
 *
 * ## Three bases, and the rule that governs all of them
 *
 * A day on a desk calendar carries three different kinds of fact, and the whole
 * design of this class is that they stay three:
 *
 *  * **`order`** — real rows in `orders`. Somebody agreed to something and the
 *    kitchen has it written down.
 *  * **`scheduled`** — `subscription_deliveries` rows the generator has claimed
 *    and not yet placed an order for. A commitment with no order behind it yet.
 *  * **`projected`** — days computed from an active subscription's weekday
 *    pattern and remaining balance. **A forecast.** No row anywhere asserts
 *    them, and the projection behind them does not consult
 *    `next_generation_date`, so after an outage — while generation catches up
 *    one delivery per tick — it still shows the pattern the customer bought
 *    rather than the backlog the kitchen is working.
 *
 * **There is no total, anywhere in this response, and there must never be one.**
 * The three overlap in ways no arithmetic can express: a scheduled day becomes
 * an order and stops being scheduled; a projected day becomes scheduled and then
 * an order; and a projection is optimistic about days a claim already exists
 * for. Summing them would double-count today and over-count next week, and a
 * kitchen buying ingredients from that number would buy too much. Three numbers
 * with three meanings, printed as three numbers, is the whole of the design —
 * and the absence of a `total` key is what stops a client inventing one and
 * believing the server agreed with it.
 *
 * ## Which orders count
 *
 * **Every non-cancelled order with a requested delivery date in the window**,
 * whatever its status. Not just the open ones: this calendar answers "what
 * leaves the kitchen that day", and a *fulfilled* order left the kitchen that
 * day — that is what fulfilled means. A calendar that dropped it would show
 * yesterday emptying itself as the day was worked, which is the opposite of a
 * production record. The desk *queue* is where "still to do" lives, and it is a
 * different surface for that reason.
 *
 * Cancelled orders count nowhere. Nothing leaves the kitchen for them, and they
 * are the one status about which that is unambiguous.
 *
 * Orders with **no requested delivery date** are excluded, and that is not the
 * queue's rule. The queue treats a dateless order as *now* and shows it today,
 * because a queue is a list of work in hand. A calendar is a grid of days, and
 * an order nobody has named a day for has no square to sit in; putting it on
 * today's would be inventing a commitment the customer never made and would move
 * it every midnight.
 *
 * ## The window breakdown, and the bucket for orders with no slot
 *
 * `windows` splits each day's three counts by `delivery_window_code`. A day's
 * unslotted work — an order or a delivery day with no named window, which is a
 * legitimate state on both tables — is an entry whose `code` is **`null`**,
 * rather than a magic string like `unslotted`. A code is a kitchen's own
 * vocabulary, defined by its own rows in `delivery_windows`, and any placeholder
 * this class invented would be a value a kitchen could also have typed. `null`
 * is the only name that cannot collide with a real one.
 *
 * Only windows that actually carry something appear on a day. A cartesian
 * product of every named slot against every day of a sixty-day window would be
 * mostly zeroes, and a screen rendering a grid knows its own slots already.
 *
 * **Every day of the window appears**, including empty ones. A calendar with
 * holes where nothing was ordered is a calendar a client has to reconstruct, and
 * "nothing that day" is itself the answer to the question the screen is asking.
 */
final readonly class CalendarComposition
{
    public function __construct(private SubscriptionOutlook $outlook) {}

    /**
     * One kitchen's forward book, day by day.
     *
     * @param  string|null  $branchId  narrow to one production site, or null for the whole organisation
     * @return list<array{
     *     date: string,
     *     counts: array{order: int, scheduled: int, projected: int},
     *     windows: list<array{code: string|null, counts: array{order: int, scheduled: int, projected: int}}>,
     * }>
     */
    public function forOrganisation(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array {
        $start = $from->startOfDay();
        $end = $to->startOfDay();

        if ($end->lessThan($start)) {
            return [];
        }

        // Every square of the grid, in order, before anything is counted into
        // it. Building the days from the counts instead would produce a calendar
        // with holes on the quiet days.
        $days = [];

        for ($day = $start; $day->lessThanOrEqualTo($end); $day = $day->addDay()) {
            $days[$day->toDateString()] = [];
        }

        // Called once. The projection behind the second and third bases is
        // O(subscriptions × days) with a query per subscription, and the port is
        // a single method precisely so that this line cannot become two.
        $subscriptions = $this->outlook->forWindow($organisationId, $start, $end, $branchId);

        $this->tally($days, $this->orderDays($organisationId, $start, $end, $branchId), 'order');
        $this->tally($days, $subscriptions['scheduled'], 'scheduled');
        $this->tally($days, $subscriptions['projected'], 'projected');

        $calendar = [];

        foreach ($days as $date => $windows) {
            $calendar[] = [
                'date' => (string) $date,
                'counts' => $this->dayTotals($windows),
                'windows' => $this->windowRows($windows),
            ];
        }

        return $calendar;
    }

    /**
     * The real orders of this window, as day-and-slot pairs.
     *
     * The organisation is the isolation boundary for this table — `orders`
     * carries no PostgreSQL policy and no global scope, deliberately — so it is
     * applied here rather than left to a caller who might forget, exactly as
     * `OrderQuery::forSeller()` and `OrderDeskQueue::forSeller()` do.
     *
     * Two columns and no model hydration: this is a count, and building sixty
     * days of `Order` objects to throw them away would be the most expensive
     * possible way to arrive at an integer.
     *
     * @return list<array{delivery_date: string, delivery_window_code: string|null}>
     */
    private function orderDays(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $rows = Order::query()
            ->where('organisation_id', $organisationId)
            // Every status except cancelled — see the class docblock. A
            // fulfilled order still left the kitchen that day.
            ->where('status', '!=', OrderStatus::Cancelled->value)
            ->whereNotNull('requested_delivery_date')
            ->whereBetween('requested_delivery_date', [$start->toDateString(), $end->toDateString()])
            ->when($branchId !== null, fn ($query) => $query->where('branch_id', $branchId))
            ->orderBy('requested_delivery_date')
            ->orderBy('id')
            ->get(['requested_delivery_date', 'delivery_window_code']);

        $days = [];

        foreach ($rows as $row) {
            $date = $row->requested_delivery_date;

            // Unreachable behind the `whereNotNull`, and present so that a
            // predicate relaxed later cannot put a dateless order on a day it
            // never named.
            if ($date === null) {
                continue;
            }

            $days[] = [
                'delivery_date' => $date->toDateString(),
                'delivery_window_code' => $row->delivery_window_code,
            ];
        }

        return $days;
    }

    /**
     * Fold one basis's days into the grid.
     *
     * All three bases go through this one method on purpose: the bucketing rule
     * — which day, which slot, and what an absent slot is called — is stated
     * once, so the three counts on a row cannot be bucketed three slightly
     * different ways.
     *
     * A day outside the window is dropped rather than added. Both sources are
     * asked for this window and neither should answer outside it; silently
     * widening the grid to fit an unexpected row would hide the disagreement.
     *
     * @param  array<string, array<array-key, array{order: int, scheduled: int, projected: int}>>  $days
     * @param  list<array{delivery_date: string, delivery_window_code: string|null}>  $rows
     * @param  'order'|'scheduled'|'projected'  $basis
     */
    private function tally(array &$days, array $rows, string $basis): void
    {
        foreach ($rows as $row) {
            $date = $row['delivery_date'];

            if (! array_key_exists($date, $days)) {
                continue;
            }

            // PHP array keys cannot be null, so the unslotted bucket is keyed on
            // the empty string *inside this method* and named `null` again on
            // the way out. The empty string is not reachable as a real code: the
            // column is `varchar(40)` and a kitchen naming a slot `''` would
            // have nothing to render, but `windowRows()` translates the key back
            // rather than trusting that, so the wire never carries a `""` code.
            $key = $row['delivery_window_code'] ?? '';

            $days[$date][$key] ??= ['order' => 0, 'scheduled' => 0, 'projected' => 0];
            $days[$date][$key][$basis]++;
        }
    }

    /**
     * The day's three counts, each summed across its own basis and never across
     * the other two.
     *
     * @param  array<array-key, array{order: int, scheduled: int, projected: int}>  $windows
     * @return array{order: int, scheduled: int, projected: int}
     */
    private function dayTotals(array $windows): array
    {
        $counts = ['order' => 0, 'scheduled' => 0, 'projected' => 0];

        foreach ($windows as $window) {
            $counts['order'] += $window['order'];
            $counts['scheduled'] += $window['scheduled'];
            $counts['projected'] += $window['projected'];
        }

        return $counts;
    }

    /**
     * The day's slots, named windows first and the unslotted bucket last.
     *
     * Alphabetical among the named ones because there is no ordering column on
     * `delivery_windows` this could honour and an arbitrary order would shuffle
     * a grid between two identical requests. The unslotted bucket goes last
     * because it is the residue rather than a slot — a screen listing named
     * windows and then "no window" reads the way a kitchen thinks about it.
     *
     * @param  array<array-key, array{order: int, scheduled: int, projected: int}>  $windows
     * @return list<array{code: string|null, counts: array{order: int, scheduled: int, projected: int}}>
     */
    private function windowRows(array $windows): array
    {
        // Cast, because PHP does not keep a numeric string as an array key. A
        // kitchen is free to call a delivery slot `12` or `0900` — the column is
        // forty characters of its own vocabulary — and `array_keys()` would hand
        // that back as the integer 12, which sorts against the other codes by a
        // different rule and reaches the wire as a number. Lookups below still
        // find the original key, since array access normalises the same way.
        $codes = array_map(strval(...), array_keys($windows));

        usort($codes, static function (string $left, string $right): int {
            if ($left === '') {
                return $right === '' ? 0 : 1;
            }

            if ($right === '') {
                return -1;
            }

            return $left <=> $right;
        });

        $rows = [];

        foreach ($codes as $code) {
            $rows[] = [
                'code' => $code === '' ? null : $code,
                'counts' => $windows[$code],
            ];
        }

        return $rows;
    }
}
