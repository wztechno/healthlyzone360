<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Services\PlanSittings;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Exceptions\SubscriptionChangeRefused;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Choosing ahead: what a subscriber eats on a given day.
 *
 * **The customer chooses every meal.** A plan sells a number of meals a day;
 * which dishes fill them, and on which delivery day, is the subscriber's
 * decision — made for every day at purchase (`SubscriptionService::create()`)
 * and changeable here, one day at a time, until that day's cut-off. Any dish
 * the plan's kitchen publishes as a meal may fill any sitting.
 *
 * ## Replace, never merge
 *
 * The whole day is replaced in one transaction, which is why the endpoint is a
 * `PUT`. A customer removing a dish means they no longer want it, and a
 * merge-shaped write cannot express a removal — the same argument
 * `/me/dietary-profile` makes about an allergy somebody no longer has.
 *
 * **A day is complete or it is refused.** The day must fill exactly the
 * sittings the subscriber bought ({@see PlanSittings}); a day with a sitting
 * missing would generate an order the kitchen cannot pack from, so it is
 * `meals_incomplete` rather than a half-written day.
 *
 * ## What it will not overwrite
 *
 * `customer`, `kitchen_default` and `repeated` rows are cleared; a
 * `substituted` row is not. The substituted row is generation's record that
 * something a person chose was unsafe and what went instead, and letting a
 * later `PUT` delete it would erase the substitution audit — so a day that has
 * been generated is refused outright rather than partially rewritten.
 *
 * ## The gates
 *
 * The subscription must be live. The date must be one of its delivery
 * weekdays. And the change window must still be open on that date — the same
 * `ChangeWindow` skip, pause and the rest consult. The refusals are collected
 * rather than thrown one at a time, so a client sending three problems is told
 * three things.
 *
 * **No allergen check here, deliberately.** Generation runs
 * `MealSafety::check()` over every choice at the moment it builds the day, with
 * the customer's declarations as they stand *then*. `safety_checked_at` is left
 * null by this service for exactly that reason: nothing has checked yet, and
 * the column says so.
 */
final readonly class MealChoiceService
{
    public function __construct(
        private ChangeWindow $window,
        private SubscriptionJournal $journal,
        private TenantContext $context,
    ) {}

    /**
     * Replace one day's chosen meals.
     *
     * @param  list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>  $meals
     * @return Collection<int, SubscriptionMealChoice>
     *
     * @throws SubscriptionChangeRefused
     */
    public function replace(
        Subscription $subscription,
        CarbonImmutable $date,
        array $meals,
        ?int $expectedLockVersion = null,
    ): Collection {
        $now = CarbonImmutable::now();
        $day = $date->startOfDay();

        $reasons = [];

        if ($expectedLockVersion !== null && $expectedLockVersion !== $subscription->lock_version) {
            $reasons[] = ['reason' => 'stale_version', 'expected' => $expectedLockVersion, 'current' => $subscription->lock_version];
        }

        if (! $subscription->status->isLive()) {
            $reasons[] = ['reason' => 'invalid_transition', 'status' => $subscription->status->value];
        }

        if (! $subscription->deliversOnWeekday($day->dayOfWeekIso)) {
            $reasons[] = ['reason' => 'not_a_delivery_day', 'delivery_date' => $day->toDateString(), 'weekdays' => $subscription->weekdays];
        }

        $reasons = [...$reasons, ...$this->window->reasonsFor($subscription, $day, $now)];

        $existingDay = SubscriptionDelivery::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $day->toDateString())
            ->first();

        if ($existingDay instanceof SubscriptionDelivery && $existingDay->status->isSettled()) {
            $reasons[] = ['reason' => 'already_settled', 'delivery_date' => $day->toDateString(), 'status' => $existingDay->status->value];
        }

        $reasons = [
            ...$reasons,
            ...$this->dayReasons($day, $this->sittingsOf($subscription), $meals),
            ...$this->mealReasons($subscription->organisation_id, $meals),
        ];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        DB::transaction(function () use ($subscription, $day, $meals): void {
            $this->writeDay($subscription, $day, $meals);
        });

        $this->journal->record(
            $subscription,
            'meals_chosen',
            deliveryDate: $day,
            // Counts and slots, never the dish names. A journal a support agent
            // reads is not the place to reproduce what somebody eats, and the
            // choice rows themselves are the record.
            detail: ['slots' => count($meals)],
        );

        return $this->forDate($subscription, $day);
    }

    /**
     * Write one day's choices over whatever a person or a default put there.
     *
     * The caller has already asked every question and holds the transaction —
     * `replace()` for one day, `SubscriptionService::create()` for the whole
     * run at purchase.
     *
     * @param  list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>  $meals
     */
    public function writeDay(Subscription $subscription, CarbonImmutable $day, array $meals): void
    {
        SubscriptionMealChoice::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $day->toDateString())
            ->whereIn('source', [
                MealChoiceSource::Customer->value,
                MealChoiceSource::KitchenDefault->value,
                MealChoiceSource::Repeated->value,
            ])
            ->delete();

        foreach ($this->numbered($meals) as $meal) {
            $choice = new SubscriptionMealChoice;
            $choice->subscription_id = (string) $subscription->getKey();
            $choice->organisation_id = $subscription->organisation_id;
            // Left null on purpose: the day frequently does not exist yet,
            // which is the whole meaning of choosing ahead.
            $choice->subscription_delivery_id = null;
            $choice->delivery_date = $day;
            $choice->slot = $meal['slot'];
            $choice->sequence = $meal['sequence'];
            $choice->catalogue_item_id = $meal['catalogue_item_id'];
            $choice->catalogue_item_variant_id = $meal['catalogue_item_variant_id'] ?? null;
            $choice->source = MealChoiceSource::Customer;
            $choice->created_by = $this->context->userId();
            $choice->save();
        }
    }

    /**
     * One day's choices, in generation's own order.
     *
     * @return Collection<int, SubscriptionMealChoice>
     */
    public function forDate(Subscription $subscription, CarbonImmutable $date): Collection
    {
        return SubscriptionMealChoice::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $date->startOfDay()->toDateString())
            ->orderBy('slot')
            ->orderBy('sequence')
            ->get();
    }

    /**
     * The sittings this subscriber bought, as sold rather than as the option
     * reads today.
     *
     * @return list<array{slot: string, sequence: int}>
     */
    public function sittingsOf(Subscription $subscription): array
    {
        // A subscription bought before servings were captured reads the
        // configuration as it stands.
        $configuration = $subscription->captured_meals_per_day === null
            ? PlanVariantProfile::withoutTenancy()->whereKey($subscription->catalogue_item_variant_id)->first()
            : null;

        return PlanSittings::for(...$subscription->servings($configuration));
    }

    /**
     * Whether one day fills exactly the sittings it needs.
     *
     * @param  list<array{slot: string, sequence: int}>  $sittings
     * @param  list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>  $meals
     * @return list<array<string, mixed>>
     */
    public function dayReasons(CarbonImmutable $day, array $sittings, array $meals): array
    {
        $needed = PlanSittings::keys($sittings);
        $sent = PlanSittings::keys($this->numbered($meals));

        $missing = array_values(array_diff($needed, $sent));
        $extra = array_values(array_diff($sent, $needed));

        if ($missing === [] && $extra === [] && count($sent) === count(array_unique($sent))) {
            return [];
        }

        return [[
            'reason' => 'meals_incomplete',
            'delivery_date' => $day->toDateString(),
            'missing' => $missing,
            'unexpected' => $extra,
        ]];
    }

    /**
     * Whether each named dish is one this kitchen sells to consumers as a meal.
     *
     * One query for every dish named, however many days were sent.
     * `withoutTenancy()` and an explicit `organisation_id` filter, the rule this
     * module follows throughout: a customer is a member of no organisation, so
     * an ambient scope would find nothing, and the seller is the subscription's
     * own column rather than a header the caller chose.
     *
     * @param  list<array{catalogue_item_id: string}>  $meals
     * @return list<array<string, mixed>>
     */
    public function mealReasons(string $organisationId, array $meals): array
    {
        $ids = array_values(array_unique(array_column($meals, 'catalogue_item_id')));

        if ($ids === []) {
            return [];
        }

        $items = CatalogueItem::withoutTenancy()
            ->whereKey($ids)
            ->where('organisation_id', $organisationId)
            ->get()
            ->keyBy(static fn (CatalogueItem $item): string => (string) $item->getKey());

        $reasons = [];

        foreach ($ids as $id) {
            $item = $items->get($id);

            if (! $item instanceof CatalogueItem) {
                // Deliberately the same answer as "belongs to another kitchen":
                // confirming that an identifier names a real dish somewhere else
                // is a disclosure.
                $reasons[] = ['reason' => 'meal_unknown', 'catalogue_item_id' => $id];

                continue;
            }

            if ($item->item_type !== CatalogueItemType::Meal) {
                $reasons[] = ['reason' => 'meal_not_a_meal', 'catalogue_item_id' => $id, 'item_type' => $item->item_type->value];
            }

            if (! $item->status->isConsumerVisible()) {
                $reasons[] = ['reason' => 'meal_not_published', 'catalogue_item_id' => $id, 'status' => $item->status->value];
            }
        }

        return $reasons;
    }

    /**
     * The meals with a sequence each: the one sent, or the count of that slot
     * so far — so a client that does not care about ordering need not count.
     *
     * @param  list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>  $meals
     * @return list<array{slot: string, sequence: int, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>
     */
    private function numbered(array $meals): array
    {
        $seen = [];
        $numbered = [];

        foreach ($meals as $meal) {
            $seen[$meal['slot']] = ($seen[$meal['slot']] ?? 0) + 1;
            $numbered[] = [...$meal, 'sequence' => $meal['sequence'] ?? $seen[$meal['slot']]];
        }

        return $numbered;
    }
}
