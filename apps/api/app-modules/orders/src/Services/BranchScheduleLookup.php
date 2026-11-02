<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use DateTimeZone;
use Healthy360\Kitchens\Models\BranchClosure;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Illuminate\Support\Collection;

/**
 * The scheduling port's one implementation, over the Kitchens module's
 * `branch_opening_hours`.
 *
 * **Which day the cut-off governs is decided here**, and the K1.7 migration
 * says so explicitly: the table records a time, and "which day it closes
 * ordering for" was left to C1. The rule is the one a kitchen actually
 * operates:
 *
 * > **The cut-off on the requested day closes ordering for that day.**
 *
 * A branch that trades 09:00–18:00 with a cut-off of 15:00 accepts orders for
 * Tuesday until 15:00 on Tuesday. The alternative reading — the cut-off on the
 * *previous* day — is a real rule too ("order by 22:00 for tomorrow"), and it
 * is expressible in exactly the same data by giving the previous day the late
 * cut-off; the migration's own example says as much. Choosing the simpler
 * reading means a kitchen configures one rule and gets one behaviour, rather
 * than the system quietly deciding which of two readings applied today.
 *
 * **A closure date comes before the week.** A holiday on a Tuesday answers
 * `closed`, the same answer a shut weekday gives, so every caller already knows
 * what to do with it. {@see BranchClosure}
 *
 * **Three things are checked, in order, and each has its own answer.**
 *
 * 1. **The date is not in the past.** Nothing about a schedule makes yesterday
 *    orderable.
 * 2. **The branch trades that weekday.** A closed day is a row with both times
 *    null — that distinction is the whole reason the table stores closed days
 *    — so `closed` is a real answer and not the absence of one.
 * 3. **The cut-off has not passed**, compared in the branch's own timezone. A
 *    kitchen in Beirut and a server in UTC disagree by two or three hours
 *    depending on the month, and an order refused at 13:00 local because the
 *    server thought it was 16:00 is a bug that only appears in one season.
 *
 * **A branch with no configured week accepts everything.** Silence is not a
 * statement that the kitchen is shut, and refusing every order from a branch
 * nobody has filled in would present a configuration gap to the customer as a
 * closure. Future days are only constrained by the cut-off when the cut-off
 * can still be reached — a request for next Tuesday is never late.
 */
final readonly class BranchScheduleLookup implements OrderSchedulingLookup
{
    public function acceptsOrderFor(string $branchId, CarbonImmutable $requestedDate, CarbonImmutable $at): bool
    {
        return $this->explain($branchId, $requestedDate, $at)['accepted'];
    }

    /**
     * @return array{accepted: bool, reason: string|null, cut_off_at: string|null}
     */
    public function explain(string $branchId, CarbonImmutable $requestedDate, CarbonImmutable $at): array
    {
        $timezone = $this->timezoneOf($branchId);
        $localNow = $at->setTimezone($timezone);
        $day = $requestedDate->startOfDay();

        if ($day->toDateString() < $localNow->toDateString()) {
            return ['accepted' => false, 'reason' => 'date_in_the_past', 'cut_off_at' => null];
        }

        if ($this->isClosedOn($this->closuresOf([$branchId], $day->toDateString()), $day->toDateString())) {
            return ['accepted' => false, 'reason' => 'closed', 'cut_off_at' => null];
        }

        $row = BranchOpeningHour::withoutTenancy()
            ->where('branch_id', $branchId)
            ->where('weekday', $day->dayOfWeekIso)
            ->first();

        if (! $row instanceof BranchOpeningHour) {
            // Unconfigured, not closed. The kitchen's own admin surface shows
            // the gap; a customer should not meet it as a refusal.
            return ['accepted' => true, 'reason' => null, 'cut_off_at' => null];
        }

        if (! $row->isOpen()) {
            return ['accepted' => false, 'reason' => 'closed', 'cut_off_at' => null];
        }

        if ($row->order_cut_off_at === null) {
            // No cut-off means orders are taken until the van leaves, which is
            // a real operating model and not a missing value.
            return ['accepted' => true, 'reason' => null, 'cut_off_at' => null];
        }

        // Only today's request can be late; a later date has not reached its
        // cut-off yet, whatever the clock says now.
        if ($day->toDateString() !== $localNow->toDateString()) {
            return ['accepted' => true, 'reason' => null, 'cut_off_at' => $row->order_cut_off_at];
        }

        $passed = $localNow->format('H:i:s') > $row->order_cut_off_at;

        return [
            'accepted' => ! $passed,
            'reason' => $passed ? 'cut_off_passed' : null,
            'cut_off_at' => $row->order_cut_off_at,
        ];
    }

    /**
     * @return list<int>
     */
    public function closedWeekdays(string $organisationId, ?string $branchId): array
    {
        $branchIds = $branchId !== null
            ? [$branchId]
            : OrganisationBranch::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('status', BranchStatus::Active->value)
                ->pluck('id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

        if ($branchIds === []) {
            return [];
        }

        /** @var array<int, array<string, true>> $shut weekday → the branches stating they are shut on it */
        $shut = [];

        foreach (BranchOpeningHour::withoutTenancy()->whereIn('branch_id', $branchIds)->get() as $row) {
            if (! $row->isOpen()) {
                $shut[$row->weekday][$row->branch_id] = true;
            }
        }

        $closed = array_keys(array_filter(
            $shut,
            static fn (array $branches): bool => count($branches) === count($branchIds),
        ));
        sort($closed);

        return $closed;
    }

    /**
     * The branch's own timezone, falling back to the application's when the
     * branch cannot be read. A clock face without a place is not a time, and
     * guessing UTC for a Beirut kitchen is how a cut-off drifts by three hours
     * for half the year.
     */
    public function timezoneOf(string $branchId): string
    {
        $branch = OrganisationBranch::withoutTenancy()->whereKey($branchId)->first();

        return $this->zone($branch instanceof OrganisationBranch ? $branch->timezone : null);
    }

    public function openMinutesSince(array $branchIds, CarbonImmutable $from, CarbonImmutable $at): int
    {
        return $this->openMinutesForEach([['branch_ids' => $branchIds, 'from' => $from]], $at)[0];
    }

    /**
     * Every branch's hours are read once and its open stretches worked out once,
     * from the earliest moment asked about, so the cost of a board of five hundred
     * tickets is one statement and a walk along a short list per ticket.
     *
     * The named branches' stretches are swept in order with a cursor, which is what
     * stops two kitchens open at the same moment counting that minute twice.
     */
    public function openMinutesForEach(array $spans, CarbonImmutable $at): array
    {
        if ($spans === []) {
            return [];
        }

        $end = $at->getTimestamp();
        $earliest = min(array_map(static fn (array $span): int => $span['from']->getTimestamp(), $spans));
        $branchIds = array_values(array_unique(array_merge(...array_values(array_column($spans, 'branch_ids')))));

        $weeks = BranchOpeningHour::withoutTenancy()->whereIn('branch_id', $branchIds)->get()->groupBy('branch_id');
        $zones = OrganisationBranch::withoutTenancy()->whereKey($branchIds)->pluck('timezone', 'id');
        $closures = $this->closuresOf($branchIds, CarbonImmutable::createFromTimestamp($earliest)->subDay()->toDateString())->groupBy('branch_id');

        $stretches = [];

        foreach ($branchIds as $branchId) {
            $stretches[$branchId] = $this->openStretches(
                $weeks->get($branchId, collect())->keyBy('weekday'),
                $this->zone($zones->get($branchId)),
                $earliest,
                $end,
                $closures->get($branchId, collect()),
            );
        }

        return array_map(static function (array $span) use ($stretches, $end): int {
            $from = $span['from']->getTimestamp();

            // No branch to read a clock from: a missing setting cannot silence an alarm.
            $open = $span['branch_ids'] === []
                ? [[$from, $end]]
                : array_merge(...array_map(static fn (string $id): array => $stretches[$id], $span['branch_ids']));

            sort($open);

            $seconds = 0;
            $cursor = $from;

            foreach ($open as [$opens, $closes]) {
                $opens = max($opens, $cursor);
                $closes = min($closes, $end);

                if ($closes > $opens) {
                    $seconds += $closes - $opens;
                    $cursor = $closes;
                }
            }

            return intdiv($seconds, 60);
        }, $spans);
    }

    /**
     * When one branch was open between two instants, as unix timestamps, on its
     * own clock. Each day starts from a fresh midnight because Beirut's clocks
     * change at midnight, and a date walked with `addDay()` alone keeps the 01:00
     * it landed on for the rest of the walk.
     *
     * A closed day is a stored row, so a weekday with no row is unconfigured and
     * counts whole, for the reason {@see OrderSchedulingLookup::openMinutesSince()}
     * gives. `closes_at > opens_at` is a CHECK, so no stretch crosses midnight.
     *
     * @param  Collection<int, BranchOpeningHour>  $week  keyed by ISO weekday
     * @param  Collection<int, BranchClosure>  $closures
     * @return list<array{int, int}>
     */
    private function openStretches(Collection $week, string $timezone, int $start, int $end, Collection $closures): array
    {
        $stretches = [];
        $day = CarbonImmutable::createFromTimestamp($start, $timezone)->startOfDay();

        while ($day->getTimestamp() < $end) {
            $next = $day->addDay()->startOfDay();
            $row = $week->get($day->dayOfWeekIso);
            $date = $day->toDateString();

            if ($this->isClosedOn($closures, $date)) {
                $day = $next;

                continue;
            }

            if ($row === null) {
                $stretches[] = [$day->getTimestamp(), $next->getTimestamp()];
            } elseif ($row->isOpen()) {
                $stretches[] = [
                    CarbonImmutable::parse("{$date} {$row->opens_at}", $timezone)->getTimestamp(),
                    CarbonImmutable::parse("{$date} {$row->closes_at}", $timezone)->getTimestamp(),
                ];
            }

            $day = $next;
        }

        return $stretches;
    }

    /**
     * Closures of these branches that have not ended before `$date`.
     *
     * @param  list<string>  $branchIds
     * @return Collection<int, BranchClosure>
     */
    private function closuresOf(array $branchIds, string $date): Collection
    {
        return BranchClosure::withoutTenancy()
            ->whereIn('branch_id', $branchIds)
            ->where('closed_to', '>=', $date)
            ->get();
    }

    /**
     * @param  Collection<int, BranchClosure>  $closures
     */
    private function isClosedOn(Collection $closures, string $date): bool
    {
        return $closures->contains(static fn (BranchClosure $closure): bool => $closure->closed_from->toDateString() <= $date
            && $closure->closed_to->toDateString() >= $date);
    }

    /**
     * A stated zone, or the application's. The column is a free string, and a
     * typing mistake on one branch must not take down the wall board or the
     * escalation sweep.
     */
    private function zone(?string $timezone): string
    {
        return $timezone !== null && in_array($timezone, DateTimeZone::listIdentifiers(), true)
            ? $timezone
            : (string) config('app.timezone', 'UTC');
    }
}
