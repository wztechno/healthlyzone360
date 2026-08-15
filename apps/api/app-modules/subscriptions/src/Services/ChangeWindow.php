<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Subscriptions\Models\Subscription;

/**
 * The 24-hour rule, in one place.
 *
 * **The number is the kitchen's, not the platform's.**
 * `subscription_plan_profiles.change_cutoff_hours` already holds it — 24 by
 * default, because both source systems state that rule from opposite directions
 * — and §2 of the approved semantics makes it govern skip, pause, resume,
 * address and window changes alike. A kitchen that preps at dawn may set 36; a
 * kitchen that will take a change until the van leaves may set 0, which is why
 * the column's CHECK is `>= 0` and why nothing here treats zero as unset.
 *
 * **The deadline is computed in the branch's own timezone.** A delivery day is
 * a day at the kitchen, not a day at the server: a Beirut kitchen's Tuesday
 * begins two or three hours before a UTC server's does depending on the month,
 * and a change window anchored to the wrong midnight is wrong by that much for
 * half the year — the same failure `BranchScheduleLookup` avoids for the branch
 * cut-off, avoided here for the same reason.
 *
 * **A delivery day is anchored at its own start**, so "more than 24 hours away"
 * means "more than 24 hours before the day begins" rather than before some
 * unstated hour within it. The alternative — anchoring on the delivery window's
 * start time — was rejected because the window is nullable, is a clock face
 * with no date, and can be changed by the very operation whose deadline it
 * would define.
 *
 * **This is not the branch cut-off**, and conflating them would be a mistake in
 * both directions. `OrderSchedulingLookup` answers "will the kitchen still take
 * an order for that day", which generation asks at the moment it places one.
 * This class answers "may the customer still change that day", which is a
 * commercial promise the plan makes. They frequently differ, and a customer
 * told that a change is closed because the kitchen has not configured its
 * opening hours would be told something untrue.
 */
final readonly class ChangeWindow
{
    /**
     * The default when a plan has no profile row at all. It matches the
     * column's own default rather than being a second opinion about it.
     */
    public const int DEFAULT_CUTOFF_HOURS = 24;

    public function cutoffHoursFor(Subscription $subscription): int
    {
        $profile = SubscriptionPlanProfile::withoutTenancy()
            ->whereKey($subscription->catalogue_item_id)
            ->first();

        return $profile instanceof SubscriptionPlanProfile
            ? $profile->change_cutoff_hours
            : self::DEFAULT_CUTOFF_HOURS;
    }

    public function profileFor(Subscription $subscription): ?SubscriptionPlanProfile
    {
        $profile = SubscriptionPlanProfile::withoutTenancy()
            ->whereKey($subscription->catalogue_item_id)
            ->first();

        return $profile instanceof SubscriptionPlanProfile ? $profile : null;
    }

    /**
     * The last moment a change to this delivery day may be made.
     */
    public function deadlineFor(Subscription $subscription, CarbonImmutable $deliveryDate): CarbonImmutable
    {
        $timezone = $this->timezoneOf($subscription->branch_id);

        $dayStart = CarbonImmutable::parse($deliveryDate->toDateString(), $timezone)->startOfDay();

        return $dayStart->subHours($this->cutoffHoursFor($subscription))->utc();
    }

    /**
     * Whether a change to this delivery day is still open.
     */
    public function isOpen(Subscription $subscription, CarbonImmutable $deliveryDate, CarbonImmutable $now): bool
    {
        return $now->lessThan($this->deadlineFor($subscription, $deliveryDate));
    }

    /**
     * The refusal, when the window has closed — empty when it has not.
     *
     * Returned as reasons rather than thrown so a caller changing three things
     * at once refuses with three sentences, the rule `PlacementRefused`
     * established.
     *
     * @return list<array<string, mixed>>
     */
    public function reasonsFor(Subscription $subscription, CarbonImmutable $deliveryDate, CarbonImmutable $now): array
    {
        if ($this->isOpen($subscription, $deliveryDate, $now)) {
            return [];
        }

        return [[
            'reason' => 'inside_cut_off',
            'delivery_date' => $deliveryDate->toDateString(),
            'cut_off_hours' => $this->cutoffHoursFor($subscription),
            'cut_off_at' => $this->deadlineFor($subscription, $deliveryDate)->toIso8601String(),
            'effective_from' => $this->firstChangeableDate($subscription, $now)->toDateString(),
        ]];
    }

    /**
     * The earliest delivery date a change can still reach.
     *
     * Walks forward from today rather than computing an offset, because the
     * answer must be a day the subscription actually delivers on: telling a
     * Monday-Wednesday customer that changes take effect from Tuesday is a
     * sentence that reads correctly and means nothing.
     */
    public function firstChangeableDate(Subscription $subscription, CarbonImmutable $now): CarbonImmutable
    {
        $candidate = $now->startOfDay();

        // A subscription delivers on at least one weekday — the table's CHECK
        // guarantees it — so fourteen days is more than enough to find two
        // whole weeks' worth of candidates and terminate.
        for ($offset = 0; $offset <= 14; $offset++) {
            $day = $candidate->addDays($offset);

            if ($subscription->deliversOnWeekday($day->dayOfWeekIso) && $this->isOpen($subscription, $day, $now)) {
                return $day;
            }
        }

        return $candidate->addDays(15);
    }

    /**
     * The branch's own timezone, falling back to the application's when there
     * is no branch or it cannot be read — the fallback `BranchScheduleLookup`
     * makes, for the same reason.
     */
    private function timezoneOf(?string $branchId): string
    {
        if ($branchId === null) {
            return (string) config('app.timezone', 'UTC');
        }

        $branch = OrganisationBranch::withoutTenancy()->whereKey($branchId)->first();

        $timezone = $branch instanceof OrganisationBranch ? $branch->timezone : null;

        return $timezone === null || $timezone === '' ? (string) config('app.timezone', 'UTC') : $timezone;
    }
}
