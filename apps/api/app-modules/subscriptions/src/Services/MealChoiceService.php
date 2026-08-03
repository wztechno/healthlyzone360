<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
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
 * Only `customer`-source rows are cleared. A `substituted` row is generation's
 * record that something a person chose was unsafe and what went instead; a
 * `kitchen_default` row is the kitchen's own filling of a slot. Letting a
 * customer's later `PUT` delete either would erase the substitution audit — the
 * one audit an allergy complaint needs most — so a day that has been generated
 * is refused outright rather than partially rewritten.
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
                ->where('source', MealChoiceSource::Customer->value)
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
     * Whether each named dish is one this kitchen sells to consumers.
     *
     * `withoutTenancy()` and an explicit `organisation_id` filter, the rule this
     * module follows throughout: a customer is a member of no organisation, so
     * an ambient scope would find nothing, and the seller is the subscription's
     * own column rather than a header the caller chose.
     *
     * @param  list<array{slot: string, sequence?: int|null, catalogue_item_id: string, catalogue_item_variant_id?: string|null}>  $meals
     * @return list<array<string, mixed>>
     */
    private function mealReasons(Subscription $subscription, array $meals): array
    {
        $reasons = [];

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
        }

        return $reasons;
    }
}
