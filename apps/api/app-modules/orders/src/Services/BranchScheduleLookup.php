<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Organisations\Models\OrganisationBranch;

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
     * The branch's own timezone, falling back to the application's when the
     * branch cannot be read. A clock face without a place is not a time, and
     * guessing UTC for a Beirut kitchen is how a cut-off drifts by three hours
     * for half the year.
     */
    private function timezoneOf(string $branchId): string
    {
        $branch = OrganisationBranch::withoutTenancy()->whereKey($branchId)->first();

        $timezone = $branch instanceof OrganisationBranch ? $branch->timezone : null;

        return $timezone === null || $timezone === '' ? (string) config('app.timezone', 'UTC') : $timezone;
    }
}
