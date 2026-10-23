<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Orders\Contracts\SubscriptionOutlook;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;

/**
 * The subscriptions module's answer to the orders module's calendar port (C4).
 *
 * Bound over `NullSubscriptionOutlook` by `SubscriptionsServiceProvider::boot()`
 * — in `boot()` rather than `register()` for the reason the delivery module
 * gives about `DeliveryJobProjection`: every provider's `register()` runs before
 * any `boot()`, so an override declared there wins whatever order package
 * discovery happens to put the two modules in.
 *
 * The read stays in the module that owns the tables, which is the point of the
 * port. Orders may not import this module — the registry edge runs
 * Subscriptions → Orders, and a reverse import would close the cycle the
 * architecture test rejects — so the desk calendar asks its question through an
 * interface and never learns that `subscription_deliveries` exists.
 *
 * ## Two bases, two sources, and only one of them is expensive
 *
 * **`scheduled` is read straight from the table**, and deliberately not derived
 * from the projection's `actual` rows. Two reasons, and both are correctness
 * rather than economy. The projection does not carry `order_id`, so it cannot
 * tell a claimed day apart from a day that has already become an order — and
 * counting the latter here would double it, because the orders module is already
 * counting the real order on its own basis. And the projection walks *active*
 * subscriptions only, while a claimed row outlives the pause that came after it:
 * the day is still on the kitchen's book, and dropping it would understate
 * tomorrow's work.
 *
 * The predicate is `status = scheduled AND order_id IS NULL`. `scheduled` is
 * generation's claim, taken before the order is placed; once the order exists
 * the row moves to `generated` and carries the identifier, so the second half of
 * the predicate is belt and braces against a row caught mid-flight rather than a
 * second rule. Skipped and cancelled rows are excluded by the status alone —
 * a skipped day is not a delivery, it is the absence of one.
 *
 * **`projected` delegates to `ScheduleProjection`, once.** That class is the
 * single definition of "what the weekday pattern says next week looks like", and
 * a second implementation here would be a second answer to the same question on
 * the one screen where they sit side by side. Its `actual` rows are dropped:
 * they are the same rows the scheduled query just read, counted by a basis that
 * already owns them.
 *
 * The projection is called exactly once per invocation, and the port's single
 * method is what guarantees it — see `SubscriptionOutlook`.
 *
 * ## One entry per meal, not per day
 *
 * A subscription day is not one thing the kitchen makes; it is the plan's
 * meals for that day, and the calendar counts food. Each day from either
 * source is expanded into its sittings before it crosses the port:
 *
 *  * **a plan with a fixed menu** (`menu_cycle_days` set) names them itself —
 *    the `plan_menu_entries` for the cycle day the date falls on, one entry
 *    per row, so two lunches on day three are two lunches. This is the same
 *    arithmetic generation fills the day from (`PlanMenuEntry::cycleDayFor`),
 *    which is the point: the calendar forecasts what the tick will write.
 *  * **otherwise the configuration says how many**: `PlanVariantProfile`'s
 *    `meals_per_day` and `snacks_per_day`. The meals are dealt onto sittings
 *    the way a day runs — one meal is lunch, two are lunch and dinner, three
 *    are the whole day — and every snack is a `snack`. A fourth meal has no
 *    sitting of its own and is counted at lunch, which is wrong by a label and
 *    right by a count.
 *  * **neither** — a subscription against a plan that has no configuration
 *    row — is one entry with a `null` slot, counted under its window alone.
 *    That is the whole answer the calendar gave before sittings existed, and
 *    it is better than dropping the day.
 *
 * A menu day with no entries falls through to the configuration rather than
 * to nothing: the plan still promised that many meals, the kitchen has simply
 * not said which. Publication refuses such a menu (`menu_days_empty`), so this
 * is a draft's forecast rather than a live plan's.
 *
 * The lookups are batched — one query each for the subscriptions, the plan
 * profiles, the menu entries and the configurations of the whole window —
 * because the projection behind the rows is already O(subscriptions × days)
 * and a query per row would square it.
 *
 * ## `branchId` narrows the two bases on two different columns, deliberately
 *
 * `scheduled` filters `subscription_deliveries.branch_id`, which generation
 * denormalises onto the row at the moment it claims the day; `projected` filters
 * `subscriptions.branch_id`, because there is no row to have denormalised
 * anything onto. Each is the only column its own basis has, and the difference
 * is visible for exactly one case: a subscription moved between branches after a
 * day was claimed keeps that claimed day at the old site while its forecast
 * moves to the new one. That is the truthful answer — the claimed day really is
 * the old kitchen's work — and collapsing the two onto the subscription's
 * current branch would silently re-assign food somebody has already committed to
 * cooking.
 */
final readonly class SubscriptionOutlookAdapter implements SubscriptionOutlook
{
    public function __construct(private ScheduleProjection $projection) {}

    /**
     * @return array{
     *     scheduled: list<array{delivery_date: string, delivery_window_code: string|null, slot: string|null}>,
     *     projected: list<array{delivery_date: string, delivery_window_code: string|null, slot: string|null}>,
     * }
     */
    public function forWindow(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array {
        $start = $from->startOfDay();
        $end = $to->startOfDay();

        if ($end->lessThan($start)) {
            return ['scheduled' => [], 'projected' => []];
        }

        $scheduled = $this->scheduled($organisationId, $start, $end, $branchId);
        $projected = $this->projected($organisationId, $start, $end, $branchId);

        $sittings = $this->sittings($organisationId, [...$scheduled, ...$projected]);

        return [
            'scheduled' => $this->perMeal($scheduled, $sittings),
            'projected' => $this->perMeal($projected, $sittings),
        ];
    }

    /**
     * Days the generator has claimed and not yet turned into an order.
     *
     * `organisation_id` is denormalised onto this table precisely so a
     * projection needs no join, and the composite index on
     * `(organisation_id, delivery_date, status)` is the one this predicate was
     * written for.
     *
     * @return list<array{subscription_id: string, delivery_date: string, delivery_window_code: string|null}>
     */
    private function scheduled(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $rows = SubscriptionDelivery::query()
            ->where('organisation_id', $organisationId)
            ->where('status', SubscriptionDeliveryStatus::Scheduled->value)
            ->whereNull('order_id')
            ->whereBetween('delivery_date', [$start->toDateString(), $end->toDateString()])
            ->when($branchId !== null, fn ($query) => $query->where('branch_id', $branchId))
            ->orderBy('delivery_date')
            ->orderBy('id')
            ->get(['subscription_id', 'delivery_date', 'delivery_window_code']);

        $days = [];

        foreach ($rows as $row) {
            $days[] = [
                'subscription_id' => (string) $row->subscription_id,
                'delivery_date' => $row->delivery_date->toDateString(),
                'delivery_window_code' => $row->delivery_window_code,
            ];
        }

        return $days;
    }

    /**
     * Days the weekday pattern says are coming, which no row asserts.
     *
     * A forecast, and the port's docblock says so at length: the projection
     * reads weekdays and balances and never consults `next_generation_date`, so
     * it stays optimistic while a lagging generator catches up. Paused
     * subscriptions project nothing at all, because a paused arrangement
     * delivers nothing until somebody resumes it and no date can be predicted
     * for that.
     *
     * @return list<array{subscription_id: string, delivery_date: string, delivery_window_code: string|null}>
     */
    private function projected(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $days = [];

        foreach ($this->projection->forOrganisation($organisationId, $start, $end, $branchId) as $row) {
            // `actual` rows are the same `subscription_deliveries` the scheduled
            // query just read, and the ones that have become orders belong to
            // the orders module's basis. Either way they are already counted.
            if ($row['basis'] !== 'projected') {
                continue;
            }

            $days[] = [
                'subscription_id' => $row['subscription_id'],
                'delivery_date' => $row['delivery_date'],
                'delivery_window_code' => $row['delivery_window_code'],
            ];
        }

        return $days;
    }

    /**
     * One port entry per sitting of each day.
     *
     * @param  list<array{subscription_id: string, delivery_date: string, delivery_window_code: string|null}>  $days
     * @param  array<string, array{cycle_days: int|null, anchor_date: string|null, menu: array<int, list<string>>, configured: list<string>, meals_per_day: int|null, snacks_per_day: int|null}>  $sittings  keyed by subscription
     * @return list<array{delivery_date: string, delivery_window_code: string|null, slot: string|null}>
     */
    private function perMeal(array $days, array $sittings): array
    {
        $entries = [];

        foreach ($days as $day) {
            $slots = $this->slotsFor($sittings[$day['subscription_id']] ?? null, $day['delivery_date']);

            foreach ($slots === [] ? [null] : $slots as $slot) {
                $entries[] = [
                    'delivery_date' => $day['delivery_date'],
                    'delivery_window_code' => $day['delivery_window_code'],
                    'slot' => $slot,
                ];
            }
        }

        return $entries;
    }

    /**
     * The sittings one subscription day carries — the menu's for that cycle
     * day when the plan has one, the configuration's count dealt onto the day
     * otherwise, and nothing when the plan says nothing.
     *
     * @param  array{cycle_days: int|null, anchor_date: string|null, menu: array<int, list<string>>, configured: list<string>, meals_per_day: int|null, snacks_per_day: int|null}|null  $sitting
     * @return list<string>
     */
    private function slotsFor(?array $sitting, string $date): array
    {
        if ($sitting === null) {
            return [];
        }

        if ($sitting['cycle_days'] !== null && $sitting['anchor_date'] !== null) {
            $cycleDay = PlanMenuEntry::cycleDayFor(
                CarbonImmutable::parse($date),
                CarbonImmutable::parse($sitting['anchor_date']),
                $sitting['cycle_days'],
            );

            $fromMenu = $sitting['menu'][$cycleDay] ?? [];

            if ($fromMenu !== []) {
                // Cut to the subscriber's own count, as generation cuts it.
                return array_map(
                    static fn (int $position): string => $fromMenu[$position],
                    PlanMenuEntry::servedPositions($fromMenu, $sitting['meals_per_day'], $sitting['snacks_per_day']),
                );
            }
        }

        return $sitting['configured'];
    }

    /**
     * What each subscription in the window is made of, read once for all of
     * them: its plan's menu cycle and entries, and its configuration's counts.
     *
     * Every read is `withoutTenancy()` with the organisation stated, the rule
     * this module follows for catalogue tables, and the subscriptions
     * themselves are narrowed to the organisation so a row that somehow
     * arrived from elsewhere cannot borrow another kitchen's menu.
     *
     * @param  list<array{subscription_id: string, delivery_date: string, delivery_window_code: string|null}>  $days
     * @return array<string, array{cycle_days: int|null, anchor_date: string|null, menu: array<int, list<string>>, configured: list<string>, meals_per_day: int|null, snacks_per_day: int|null}>
     */
    private function sittings(string $organisationId, array $days): array
    {
        $subscriptionIds = array_values(array_unique(array_column($days, 'subscription_id')));

        if ($subscriptionIds === []) {
            return [];
        }

        $subscriptions = Subscription::query()
            ->where('organisation_id', $organisationId)
            ->whereKey($subscriptionIds)
            ->get(['id', 'catalogue_item_id', 'catalogue_item_variant_id', 'captured_meals_per_day', 'captured_snacks_per_day']);

        $planIds = $subscriptions->pluck('catalogue_item_id')->unique()->values()->all();
        $variantIds = $subscriptions->pluck('catalogue_item_variant_id')->unique()->values()->all();

        $profiles = SubscriptionPlanProfile::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('catalogue_item_id', $planIds)
            ->get()
            ->keyBy(static fn (SubscriptionPlanProfile $profile): string => (string) $profile->catalogue_item_id);

        $menuPlanIds = $profiles
            ->filter(static fn (SubscriptionPlanProfile $profile): bool => $profile->menu_cycle_days !== null)
            ->keys()
            ->all();

        /** @var array<string, array<int, list<string>>> $menus plan → cycle day → slots, in sitting order */
        $menus = [];

        if ($menuPlanIds !== []) {
            $entries = PlanMenuEntry::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereIn('catalogue_item_id', $menuPlanIds)
                ->orderBy('cycle_day')
                ->orderByRaw("CASE slot WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END")
                ->orderBy('sequence')
                ->get(['catalogue_item_id', 'cycle_day', 'slot']);

            foreach ($entries as $entry) {
                $menus[(string) $entry->catalogue_item_id][$entry->cycle_day][] = (string) $entry->slot;
            }
        }

        $configurations = PlanVariantProfile::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('catalogue_item_variant_id', $variantIds)
            ->get()
            ->keyBy(static fn (PlanVariantProfile $profile): string => (string) $profile->catalogue_item_variant_id);

        $sittings = [];

        foreach ($subscriptions as $subscription) {
            $profile = $profiles->get((string) $subscription->catalogue_item_id);
            $configuration = $configurations->get((string) $subscription->catalogue_item_variant_id);
            // As sold, not as the option reads today.
            [$meals, $snacks] = $subscription->servings($configuration instanceof PlanVariantProfile ? $configuration : null);

            $sittings[(string) $subscription->getKey()] = [
                'cycle_days' => $profile?->menu_cycle_days,
                'anchor_date' => $profile?->menu_cycle_anchor_date?->toDateString(),
                'menu' => $menus[(string) $subscription->catalogue_item_id] ?? [],
                'configured' => $meals !== null
                    ? $this->dealt($meals, $snacks ?? 0)
                    : [],
                'meals_per_day' => $meals,
                'snacks_per_day' => $snacks,
            ];
        }

        return $sittings;
    }

    /**
     * A day's meal count dealt onto sittings, the way a day runs.
     *
     * @return list<string>
     */
    private function dealt(int $meals, int $snacks): array
    {
        $slots = match (true) {
            $meals <= 0 => [],
            $meals === 1 => ['lunch'],
            $meals === 2 => ['lunch', 'dinner'],
            default => ['breakfast', 'lunch', 'dinner', ...array_fill(0, $meals - 3, 'lunch')],
        };

        return [...$slots, ...array_fill(0, max(0, $snacks), 'snack')];
    }
}
