<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Carbon\CarbonImmutable;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\OrganisationBranch;

/**
 * The next fortnight of a kitchen's ordering calendar, derived from its
 * branches' operating weeks.
 *
 * ## Derived, never stored
 *
 * There is no availability table. What exists is `branch_opening_hours`: seven
 * rows a branch, each with an opening time, a closing time and the last moment
 * an order for that same day is accepted. Everything below is read off those
 * rows, so a kitchen that changes its Friday changes its calendar, and nothing
 * can go stale.
 *
 * ## The rules, and why each one is the honest reading
 *
 * **A day is orderable when at least one active branch is open on it.** A
 * kitchen with two branches is shut on a date only if both are. The union is
 * the right operator because the consumer contract's calendar belongs to the
 * *kitchen*: a customer is asking "can I have this on Thursday", not "can the
 * Al Quoz kitchen make it".
 *
 * **A day nobody has configured is not orderable.** `branch_opening_hours`
 * distinguishes "we are shut" (a row with no times) from "nobody has said" (no
 * row at all), and both answer this question the same way — a customer must not
 * be offered a date the kitchen has never agreed to. The distinction still
 * matters upstream, which is why the storage keeps it and only this projection
 * collapses it.
 *
 * **The cut-off closes today.** If today's last order time has already passed
 * in the branch's own timezone, today is not available. That is what a cut-off
 * *is*; a calendar that ignored it would offer a delivery nobody can produce.
 * Where several branches are open on a date, the latest cut-off wins — the last
 * moment an order for that date is accepted anywhere in the kitchen.
 *
 * **`remaining` is always null.** The platform stores no stock counts, and
 * `null` is what the contract reserves for "the kitchen does not publish
 * remaining stock". A zero would say sold out; a large number would be
 * invented.
 *
 * The window is 14 days starting today, in the branch's timezone rather than
 * the server's — a kitchen in Dubai rolls over its calendar four hours before a
 * server in UTC would.
 */
final class MarketplaceAvailability
{
    /** Days of calendar the marketplace publishes. */
    public const int WINDOW_DAYS = 14;

    /**
     * @param  list<OrganisationBranch>  $branches  the kitchen's active branches
     * @param  list<BranchOpeningHour>  $hours  every configured day of those branches
     * @return list<array{date: string, available: bool, remaining: null, order_cut_off_at: string|null}>
     */
    public function calendar(array $branches, array $hours, ?CarbonImmutable $now = null): array
    {
        if ($branches === []) {
            return [];
        }

        $moment = $now ?? CarbonImmutable::now();

        /** @var array<string, array<int, BranchOpeningHour>> $byBranch */
        $byBranch = [];

        foreach ($hours as $day) {
            $byBranch[$day->branch_id][$day->weekday] = $day;
        }

        // The calendar's own days are counted in the first branch's timezone.
        // A kitchen whose branches straddle timezones has a genuinely ambiguous
        // "today", and picking the first branch deterministically beats picking
        // whichever one the database returned first.
        $calendarZone = $branches[0]->timezone;
        $start = $moment->setTimezone($calendarZone)->startOfDay();

        $calendar = [];

        for ($offset = 0; $offset < self::WINDOW_DAYS; $offset++) {
            $date = $start->addDays($offset);
            $latestCutOff = null;
            $available = false;

            foreach ($branches as $branch) {
                $day = $byBranch[$branch->getKey()][$date->dayOfWeekIso] ?? null;

                if (! $day instanceof BranchOpeningHour || ! $day->isOpen()) {
                    continue;
                }

                $cutOff = $this->cutOffInstant($date, $branch->timezone, $day->order_cut_off_at);

                // A branch with no stated cut-off accepts orders for that date
                // all day: the column is nullable, and reading its absence as
                // "closed at midnight" would refuse orders nobody refused.
                if ($cutOff !== null && $cutOff->lessThanOrEqualTo($moment)) {
                    continue;
                }

                $available = true;

                if ($cutOff !== null && ($latestCutOff === null || $cutOff->greaterThan($latestCutOff))) {
                    $latestCutOff = $cutOff;
                }
            }

            $calendar[] = [
                'date' => $date->toDateString(),
                'available' => $available,
                'remaining' => null,
                'order_cut_off_at' => $available ? $latestCutOff?->toIso8601String() : null,
            ];
        }

        return $calendar;
    }

    /**
     * The moment a clock-face cut-off falls on a given date, in the branch's own
     * timezone.
     *
     * `order_cut_off_at` is stored as `H:i:s` precisely because it has no date
     * and no zone of its own (the column's own documentation says so); this is
     * the one place that gives it both, and it gives it the branch's, never the
     * server's.
     */
    private function cutOffInstant(CarbonImmutable $date, string $timezone, ?string $clock): ?CarbonImmutable
    {
        if ($clock === null || trim($clock) === '') {
            return null;
        }

        return CarbonImmutable::parse($date->toDateString().' '.$clock, $timezone);
    }
}
