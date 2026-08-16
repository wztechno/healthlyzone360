<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Catalogues\Services\PlanMenuService;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Exceptions\SubscriptionChangeRefused;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Choosing ahead: what a Free Selection subscriber wants on a given day.
 *
 * **The writer for a table S1 shipped with only a reader.**
 * `GenerationService::safeMealsFor()` reads `subscription_meal_choices`, runs
 * the allergen gate over each one and substitutes where it must; nothing wrote
 * them except a test fixture, because the surface that lets a customer choose
 * is HTTP and HTTP was the integration wave's. This is that writer, and it is
 * deliberately the smallest thing that closes the gap.
 *
 * ## Replace, never merge
 *
 * The whole day is replaced in one transaction, which is why the endpoint is a
 * `PUT`. A customer removing a dish means they no longer want it, and a
 * merge-shaped write cannot express a removal — the same argument
 * `/me/dietary-profile` makes about an allergy somebody no longer has. The
 * `{"meals": []}` payload is what "I have not chosen; send me the kitchen's
 * default" looks like, and it has to be sendable.
 *
 * ## What it will not overwrite
 *
 * `customer` and `kitchen_default` rows are cleared; a `substituted` row is
 * not. The substituted row is generation's record that something a person chose
 * was unsafe and what went instead, and letting a later `PUT` delete it would
 * erase the substitution audit — the one audit an allergy complaint needs most
 * — so a day that has been generated is refused outright rather than partially
 * rewritten.
 *
 * A `kitchen_default` row is a different thing: it is the plan menu's own
 * filling of a slot nobody had chosen, written by generation from
 * `plan_menu_entries`. It is not evidence of anything a person did, and it
 * occupies the same `(subscription, date, slot, sequence)` coordinate a
 * customer's choice would — so leaving it in place while inserting the
 * customer's row beside it would raise a raw unique violation rather than a
 * refusal anyone could act on. **The default yields to the person**, which is
 * both the correct commercial answer and the only one the index admits.
 *
 * ## The four gates
 *
 * The plan must allow free selection at all (`allows_free_selection` on the
 * kitchen's own profile — a plan sold as a fixed menu does not become
 * choose-your-own because a client sent a body). The subscription must be live.
 * The date must be one of its delivery weekdays. And the change window must
 * still be open on that date — the same `ChangeWindow` skip, pause and the rest
 * consult, because §2's one sentence applies to every change a customer makes
 * and asking it in five places with five answers is how it stops being one
 * rule.
 *
 * The refusals are `SubscriptionChangeRefused` and they are collected rather
 * than thrown one at a time, so a client sending three problems is told three
 * things.
 *
 * **No allergen check here, deliberately.** Generation runs
 * `MealSafety::check()` over every choice at the moment it builds the day, with
 * the customer's declarations as they stand *then*. Checking at choice time as
 * well would produce a verdict that is stale by the time it matters — somebody
 * declares an allergy on Tuesday for food chosen on Monday — and would tempt a
 * later reader into trusting the earlier answer. `safety_checked_at` is left
 * null by this service for exactly that reason: nothing has checked yet, and
 * the column says so.
 */
final readonly class MealChoiceService
{
    public function __construct(
        private ChangeWindow $window,
        private SubscriptionJournal $journal,
        private TenantContext $context,
        private PlanMenuService $menus,
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

        $profile = $this->window->profileFor($subscription);

        if (! $profile instanceof SubscriptionPlanProfile || ! $profile->allows_free_selection) {
            $reasons[] = ['reason' => 'not_permitted', 'right' => 'choose_meals'];
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

        $reasons = [...$reasons, ...$this->mealReasons($subscription, $meals)];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        DB::transaction(function () use ($subscription, $day, $meals): void {
            SubscriptionMealChoice::query()
                ->where('subscription_id', $subscription->getKey())
                ->whereDate('delivery_date', $day->toDateString())
                ->whereIn('source', [MealChoiceSource::Customer->value, MealChoiceSource::KitchenDefault->value])
                ->delete();

            foreach ($meals as $position => $meal) {
                $choice = new SubscriptionMealChoice;
                $choice->subscription_id = (string) $subscription->getKey();
                $choice->organisation_id = $subscription->organisation_id;
                // Left null on purpose: the day frequently does not exist yet,
                // which is the whole meaning of choosing ahead. Generation links
                // it when it creates the delivery.
                $choice->subscription_delivery_id = null;
                $choice->delivery_date = $day;
                $choice->slot = $meal['slot'];
                $choice->sequence = $meal['sequence'] ?? $position + 1;
                $choice->catalogue_item_id = $meal['catalogue_item_id'];
                $choice->catalogue_item_variant_id = $meal['catalogue_item_variant_id'] ?? null;
                $choice->source = MealChoiceSource::Customer;
                $choice->created_by = $this->context->userId();
                $choice->save();
            }
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
     * Whether each named dish is one this kitchen sells to consumers, and — on
     * a plan that publishes a menu — one this plan serves at all.
     *
     * `withoutTenancy()` and an explicit `organisation_id` filter, the rule this
     * module follows throughout: a customer is a member of no organisation, so
     * an ambient scope would find nothing, and the seller is the subscription's
     * own column rather than a header the caller chose.
     *
     * ## `meal_not_on_plan_menu` asks about the plan's repertoire, not the day's
     *
     * The fourth check fires **only** when the plan has a published menu, and
     * it refuses a dish that appears on no entry of that menu — on any cycle
     * day. It is deliberately not date-specific, and this method deliberately
     * does not take the delivery date although `replace()` has one in scope and
     * could pass it.
     *
     * Three arguments, in the order they decided it:
     *
     *  * **Per-day would make free selection meaningless.** This service only
     *    runs on a plan whose profile sets `allows_free_selection`, and on such
     *    a plan the menu is the kitchen's *default*, not its dictate — the
     *    slot's filling for a customer who chooses nothing. Narrowing a choice
     *    to the day's own entries would let a customer choose exactly what they
     *    would have been sent anyway, which is not a choice.
     *  * **It would refuse Thursday's dish chosen on Tuesday.** A customer
     *    reading a plan sees the rotation, not one day of it; a dish they saw on
     *    the menu is a dish the plan serves, and telling them otherwise because
     *    they picked it for the wrong date is a rule nobody could have followed.
     *  * **It would rot.** A menu re-published with a new anchor or a longer
     *    cycle moves every date's entries. A per-day rule would retroactively
     *    invalidate choices that were legal when they were made, without
     *    anything rewriting them.
     *
     * What the repertoire reading still refuses is the thing worth refusing: a
     * dish the kitchen sells but never puts on this plan. A free-selection plan
     * with **no** menu keeps exactly three checks — there is no repertoire to
     * compare against, and inventing one from the kitchen's whole catalogue
     * would be the narrowing this reading rejects, applied backwards.
     *
     * @param  list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>  $meals
     * @return list<array<string, mixed>>
     */
    private function mealReasons(Subscription $subscription, array $meals): array
    {
        if ($meals === []) {
            return [];
        }

        $reasons = [];
        $repertoire = $this->planRepertoire($subscription);

        foreach ($meals as $meal) {
            $item = CatalogueItem::withoutTenancy()
                ->whereKey($meal['catalogue_item_id'])
                ->where('organisation_id', $subscription->organisation_id)
                ->first();

            if (! $item instanceof CatalogueItem) {
                // Deliberately the same answer as "belongs to another kitchen":
                // confirming that an identifier names a real dish somewhere else
                // is a disclosure, and this is the C1 rule applied to a menu.
                $reasons[] = ['reason' => 'meal_unknown', 'catalogue_item_id' => $meal['catalogue_item_id']];

                continue;
            }

            if ($item->item_type !== CatalogueItemType::Meal) {
                $reasons[] = ['reason' => 'meal_not_a_meal', 'catalogue_item_id' => $meal['catalogue_item_id'], 'item_type' => $item->item_type->value];
            }

            if (! $item->status->isConsumerVisible()) {
                $reasons[] = ['reason' => 'meal_not_published', 'catalogue_item_id' => $meal['catalogue_item_id'], 'status' => $item->status->value];
            }

            if ($repertoire !== null && ! in_array((string) $item->getKey(), $repertoire, true)) {
                $reasons[] = ['reason' => 'meal_not_on_plan_menu', 'catalogue_item_id' => $meal['catalogue_item_id']];
            }
        }

        return $reasons;
    }

    /**
     * Every dish the plan's menu names, on any day of its cycle — or **null**
     * when the plan publishes no menu.
     *
     * Null and `[]` are different answers and the caller reads them as such:
     * null is "this plan has no repertoire to be off", while an empty list
     * would be "it has one and it is empty", which the menu service refuses to
     * store. Read once per call rather than once per submitted dish.
     *
     * @return list<string>|null
     */
    private function planRepertoire(Subscription $subscription): ?array
    {
        $plan = CatalogueItem::withoutTenancy()
            ->whereKey($subscription->catalogue_item_id)
            ->where('organisation_id', $subscription->organisation_id)
            ->first();

        if (! $plan instanceof CatalogueItem) {
            return null;
        }

        if ($this->menus->cycleFor($plan)['cycle_days'] === null) {
            return null;
        }

        return array_values(array_unique(array_map(
            static fn (PlanMenuEntry $entry): string => $entry->meal_catalogue_item_id,
            $this->menus->entriesFor($plan),
        )));
    }
}
