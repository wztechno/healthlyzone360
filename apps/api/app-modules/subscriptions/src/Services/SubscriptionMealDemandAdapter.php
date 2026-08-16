<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Contracts\SubscriptionMealDemand;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;

/**
 * The subscriptions module's answer to the inventory module's requirement-
 * forecast port.
 *
 * Bound over `NullSubscriptionMealDemand` by `SubscriptionsServiceProvider::boot()`
 * — in `boot()` rather than `register()` for the reason the delivery and
 * inventory modules both give: every provider's `register()` runs before any
 * `boot()`, so an override declared there wins whatever order package discovery
 * happens to put the two modules in.
 *
 * The read stays in the module that owns the tables, which is the point of the
 * port. Inventory may not import this module, so the forecast asks its question
 * through an interface and never learns that `subscription_meal_choices` exists.
 *
 * ## The two bases are the outlook's two bases, for the outlook's two reasons
 *
 * `scheduled` is read straight from `subscription_deliveries` — status
 * `scheduled` and `order_id IS NULL` — rather than derived from the projection,
 * because the projection carries no `order_id` (so it cannot tell a claimed day
 * from one that has already become an order) and walks *active* subscriptions
 * only (so it drops a claim that outlived the pause that came after it). Both
 * failures would be wrong in the same direction here as on the calendar: the
 * first would double-count food, the second would under-buy for it.
 * {@see SubscriptionOutlookAdapter} states the argument at length; this class
 * applies it to the same tables for a different consumer.
 *
 * `projected` delegates to {@see ScheduleProjection}, **once**. The port's single
 * method is what guarantees the once.
 *
 * ## Generated days are absent, and that is the anti-double-count rule
 *
 * A day the generator has turned into an order carries real meal lines on that
 * order, and the forecast counts every non-cancelled order line as its first
 * population. Returning such a day — or the choice rows behind it — would count
 * one Tuesday's chicken twice. `scheduled` excludes it by predicate; `projected`
 * cannot reach it, because the projection reports a day with a delivery row as
 * `actual` and this class keeps only `projected`. The choice query is then
 * restricted to the (subscription, date) pairs those two bases produced, so a
 * choice standing against a generated day is excluded by the same rule rather
 * than by a second one.
 *
 * ## Tenancy
 *
 * Every read is explicitly organisation-scoped and none depends on ambient
 * context: the forecast is callable from a job, exactly as consumption is.
 * `SubscriptionMealChoice` carries no tenancy scope of its own (the decision
 * `Subscription` records) and is narrowed by its `organisation_id` column and by
 * the day set together.
 */
final readonly class SubscriptionMealDemandAdapter implements SubscriptionMealDemand
{
    public function __construct(private ScheduleProjection $projection) {}

    /**
     * @return array{
     *     days: list<array{subscription_id: string, plan_catalogue_item_id: string, delivery_date: string, basis: string}>,
     *     choices: list<array{subscription_id: string, delivery_date: string, slot: string, sequence: int, catalogue_item_id: string}>,
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
            return ['days' => [], 'choices' => []];
        }

        $days = [
            ...$this->scheduled($organisationId, $start, $end, $branchId),
            ...$this->projected($organisationId, $start, $end, $branchId),
        ];

        return ['days' => $days, 'choices' => $this->choices($organisationId, $days)];
    }

    /**
     * Days the generator has claimed and not yet turned into an order.
     *
     * The plan comes from a join rather than a second query per row: the
     * delivery row records which subscription it belongs to and the subscription
     * records which plan was bought, and a forecast reading sixty days of a busy
     * kitchen would otherwise issue one query per claimed day.
     *
     * @return list<array{subscription_id: string, plan_catalogue_item_id: string, delivery_date: string, basis: string}>
     */
    private function scheduled(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $rows = SubscriptionDelivery::query()
            ->where('subscription_deliveries.organisation_id', $organisationId)
            ->where('subscription_deliveries.status', SubscriptionDeliveryStatus::Scheduled->value)
            ->whereNull('subscription_deliveries.order_id')
            ->whereBetween('subscription_deliveries.delivery_date', [$start->toDateString(), $end->toDateString()])
            ->when($branchId !== null, fn ($query) => $query->where('subscription_deliveries.branch_id', $branchId))
            ->join('subscriptions', 'subscriptions.id', '=', 'subscription_deliveries.subscription_id')
            ->orderBy('subscription_deliveries.delivery_date')
            ->orderBy('subscription_deliveries.id')
            ->get([
                'subscription_deliveries.subscription_id',
                'subscription_deliveries.delivery_date',
                'subscriptions.catalogue_item_id as plan_catalogue_item_id',
            ]);

        $days = [];

        foreach ($rows as $row) {
            $days[] = [
                'subscription_id' => (string) $row->subscription_id,
                'plan_catalogue_item_id' => (string) $row->getAttribute('plan_catalogue_item_id'),
                'delivery_date' => $row->delivery_date->toDateString(),
                'basis' => 'scheduled',
            ];
        }

        return $days;
    }

    /**
     * Days the weekday pattern says are coming, which no row asserts.
     *
     * A forecast inside a forecast, and the outer one is labelled for it: the
     * projection reads weekdays and balances and never consults
     * `next_generation_date`, so it stays optimistic while a lagging generator
     * catches up. Paused subscriptions project nothing at all.
     *
     * The plans are read in one pass keyed by subscription, because the
     * projection answers in identifiers and a forecast wants the plan for each
     * of them without a query per day.
     *
     * @return list<array{subscription_id: string, plan_catalogue_item_id: string, delivery_date: string, basis: string}>
     */
    private function projected(
        string $organisationId,
        CarbonImmutable $start,
        CarbonImmutable $end,
        ?string $branchId,
    ): array {
        $rows = array_values(array_filter(
            $this->projection->forOrganisation($organisationId, $start, $end, $branchId),
            static fn (array $row): bool => $row['basis'] === 'projected',
        ));

        if ($rows === []) {
            return [];
        }

        /** @var array<string, string> $plans */
        $plans = Subscription::query()
            ->where('organisation_id', $organisationId)
            ->whereKey(array_values(array_unique(array_column($rows, 'subscription_id'))))
            ->pluck('catalogue_item_id', 'id')
            ->map(static fn (mixed $planId): string => (string) $planId)
            ->all();

        $days = [];

        foreach ($rows as $row) {
            $planId = $plans[$row['subscription_id']] ?? null;

            if ($planId === null) {
                // Unreachable: the projection just read these subscriptions from
                // this organisation. Dropped rather than guessed at, so a row
                // that somehow arrived from elsewhere cannot put another
                // kitchen's plan on this kitchen's buy list.
                continue;
            }

            $days[] = [
                'subscription_id' => $row['subscription_id'],
                'plan_catalogue_item_id' => $planId,
                'delivery_date' => $row['delivery_date'],
                'basis' => 'projected',
            ];
        }

        return $days;
    }

    /**
     * The meal choices standing against those days.
     *
     * One query for the whole window, narrowed by the organisation and the
     * window and then filtered in memory against the exact (subscription, date)
     * pairs the two bases produced — rather than a `WHERE (a, b) IN (...)` with
     * a pair per claimed day, which for sixty days of a busy kitchen is a
     * statement thousands of terms long. The window bound does the work in the
     * index; the pair check does the correctness.
     *
     * **Source is not filtered.** A `customer` row, a `kitchen_default` one and
     * a `substituted` one are all the same fact to a buyer: that dish is what
     * the kitchen currently intends to cook on that day. Preferring one source
     * over another here would forecast something other than what generation will
     * read back.
     *
     * @param  list<array{subscription_id: string, plan_catalogue_item_id: string, delivery_date: string, basis: string}>  $days
     * @return list<array{subscription_id: string, delivery_date: string, slot: string, sequence: int, catalogue_item_id: string}>
     */
    private function choices(string $organisationId, array $days): array
    {
        if ($days === []) {
            return [];
        }

        $dates = array_values(array_unique(array_column($days, 'delivery_date')));
        $wanted = [];

        foreach ($days as $day) {
            $wanted[$day['subscription_id'].'|'.$day['delivery_date']] = true;
        }

        $rows = SubscriptionMealChoice::query()
            ->where('organisation_id', $organisationId)
            ->whereIn('subscription_id', array_values(array_unique(array_column($days, 'subscription_id'))))
            ->whereIn('delivery_date', $dates)
            ->orderBy('delivery_date')
            ->orderBy('slot')
            ->orderBy('sequence')
            ->get(['subscription_id', 'delivery_date', 'slot', 'sequence', 'catalogue_item_id']);

        $choices = [];

        foreach ($rows as $row) {
            $date = $row->delivery_date->toDateString();

            if (! array_key_exists($row->subscription_id.'|'.$date, $wanted)) {
                continue;
            }

            $choices[] = [
                'subscription_id' => (string) $row->subscription_id,
                'delivery_date' => $date,
                'slot' => $row->slot,
                'sequence' => $row->sequence,
                'catalogue_item_id' => (string) $row->catalogue_item_id,
            ];
        }

        return $choices;
    }
}
