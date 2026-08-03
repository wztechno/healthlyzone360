<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

/**
 * The facts a customer's subscription is *about*, gathered for the presenter.
 *
 * A subscription row is a row of identifiers: which plan, which configuration,
 * which run, which address. That is the right shape for a table and the wrong
 * one for a screen — a person looking at "cancel this subscription" needs to
 * see the plan's name, the kitchen's name and the address it goes to, and none
 * of those is on the row. This class turns the identifiers into the facts, and
 * exists rather than living in the presenter for one reason:
 *
 * **It batches.** `GET /me/subscriptions` is unpaginated by design — a person
 * has a handful — and a presenter that reached for `$subscription->plan` would
 * make it N+1 in six different directions. Everything here is `whereIn` over
 * the whole set: nine queries whatever the count, and the same nine for one
 * subscription as for ten.
 *
 * **Every read is `withoutTenancy()` with an explicit `organisation_id`
 * filter**, the rule this module follows throughout: a customer is a member of
 * no organisation, so the ambient scope would either throw or be the wrong
 * organisation, and the seller is the subscription's own column rather than a
 * header the caller chose. `CustomerAddress` and `Organisation` are unscoped
 * models and are read directly.
 *
 * ## What is deliberately not gathered
 *
 * - **The sales channel's name.** `SalesChannel` is classified `Internal`, and
 *   which desk a purchase was routed through is the kitchen's bookkeeping. The
 *   identifier already travels because generation prices against it.
 * - **The branch.** `OrderPresenter` withholds it from customers as "the
 *   kitchen's operating arrangements", and a subscription is no different.
 * - **Diet classifications and excluded allergens.** Neither is on the
 *   subscription: a plan's diet classification belongs to the plan and is shown
 *   on the plan page, and there is no per-subscription allergen exclusion —
 *   safety comes from the customer's dietary profile and is applied at
 *   generation. Serving an empty list here would read as "this subscription
 *   excludes nothing", which is a claim about safety nobody made.
 */
final readonly class SubscriptionProjection
{
    /**
     * The gathered facts for one subscription.
     *
     * @return array<string, mixed>
     */
    public function for(Subscription $subscription): array
    {
        /** @var Collection<int, Subscription> $one */
        $one = new Collection([$subscription]);

        return $this->forMany($one)[(string) $subscription->getKey()] ?? [];
    }

    /**
     * The gathered facts for a set, keyed by subscription identifier.
     *
     * @param  Collection<int, Subscription>  $subscriptions
     * @return array<string, array<string, mixed>>
     */
    public function forMany(Collection $subscriptions): array
    {
        if ($subscriptions->isEmpty()) {
            return [];
        }

        $ids = array_values(
            $subscriptions->map(static fn (Subscription $s): string => (string) $s->getKey())->all(),
        );
        $organisationIds = $subscriptions->pluck('organisation_id')->unique()->values()->all();

        $plans = $this->keyed(CatalogueItem::withoutTenancy()
            ->whereIn('organisation_id', $organisationIds)
            ->whereIn('id', $subscriptions->pluck('catalogue_item_id')->unique()->values()->all())
            ->get());

        $variants = $this->keyed(CatalogueItemVariant::withoutTenancy()
            ->whereIn('organisation_id', $organisationIds)
            ->whereIn('id', $subscriptions->pluck('catalogue_item_variant_id')->unique()->values()->all())
            ->get());

        $durations = $this->keyed(PlanDuration::withoutTenancy()
            ->whereIn('organisation_id', $organisationIds)
            ->whereIn('id', $subscriptions->pluck('plan_duration_id')->unique()->values()->all())
            ->get());

        $profiles = $this->keyed(SubscriptionPlanProfile::withoutTenancy()
            ->whereIn('organisation_id', $organisationIds)
            ->whereIn('catalogue_item_id', $subscriptions->pluck('catalogue_item_id')->unique()->values()->all())
            ->get());

        $kitchens = $this->keyed(Organisation::query()->whereIn('id', $organisationIds)->get());

        $addresses = $this->keyed(CustomerAddress::query()
            ->whereIn('id', $subscriptions->pluck('customer_address_id')->unique()->values()->all())
            ->get());

        $startedOn = $this->startDates($ids);
        $skipped = $this->skippedDates($ids);
        $chosen = $this->chosenMealIds($ids);

        $gathered = [];

        foreach ($subscriptions as $subscription) {
            $id = (string) $subscription->getKey();
            $plan = $plans[$subscription->catalogue_item_id] ?? null;
            $variant = $variants[$subscription->catalogue_item_variant_id] ?? null;
            $duration = $durations[$subscription->plan_duration_id] ?? null;
            $profile = $profiles[$subscription->catalogue_item_id] ?? null;
            $kitchen = $kitchens[$subscription->organisation_id] ?? null;
            $address = $addresses[$subscription->customer_address_id] ?? null;

            $gathered[$id] = [
                'plan' => $plan,
                'variant' => $variant,
                'duration' => $duration,
                'profile' => $profile,
                'kitchen' => $kitchen,
                'address' => $address,
                // The first delivery the ledger holds. `next_generation_date` is
                // the fallback for a subscription bought moments ago whose first
                // day has not been generated yet; the purchase date is the last
                // resort, and is never wrong by more than the lead time.
                'started_on' => $startedOn[$id]
                    ?? $subscription->next_generation_date?->toDateString()
                    ?? $subscription->captured_at->toDateString(),
                'skipped_dates' => $skipped[$id] ?? [],
                'chosen_catalogue_item_ids' => $chosen[$id] ?? [],
            ];
        }

        return $gathered;
    }

    /**
     * Dish names for a set of meal choices, in the caller's language.
     *
     * One query for a whole ledger page, and it takes the *choices* rather than
     * a list of identifiers so that the substituted item's name is resolved
     * too — a customer told "we sent something else" is owed both names.
     *
     * @param  Collection<int, SubscriptionMealChoice>  $choices
     * @return array<string, string>
     */
    public function mealNames(Collection $choices, string $organisationId, string $locale): array
    {
        $ids = $choices
            ->flatMap(static fn (SubscriptionMealChoice $choice): array => array_filter([
                $choice->catalogue_item_id,
                $choice->replaced_catalogue_item_id,
            ]))
            ->unique()
            ->values()
            ->all();

        if ($ids === []) {
            return [];
        }

        $names = [];

        $items = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('id', $ids)
            ->get(['id', 'name_en', 'name_ar']);

        foreach ($items as $item) {
            $names[(string) $item->getKey()] = SubscriptionLocale::pick(
                $locale,
                $item->name_en,
                $item->name_ar,
            );
        }

        return $names;
    }

    /**
     * @template TModel of Model
     *
     * @param  EloquentCollection<int, TModel>  $models
     * @return array<string, TModel>
     */
    private function keyed(EloquentCollection $models): array
    {
        $keyed = [];

        foreach ($models as $model) {
            $keyed[(string) $model->getKey()] = $model;
        }

        return $keyed;
    }

    /**
     * The earliest delivery date per subscription — one aggregate, not one per row.
     *
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function startDates(array $ids): array
    {
        $rows = SubscriptionDelivery::query()
            ->whereIn('subscription_id', $ids)
            ->groupBy('subscription_id')
            ->selectRaw('subscription_id, MIN(delivery_date) as first_date')
            ->get();

        $dates = [];

        foreach ($rows as $row) {
            /** @var string|null $first */
            $first = $row->getAttribute('first_date');

            if ($first !== null) {
                $dates[(string) $row->getAttribute('subscription_id')] = substr($first, 0, 10);
            }
        }

        return $dates;
    }

    /**
     * Days that were scheduled and skipped, whoever skipped them.
     *
     * All three skip statuses, not only the customer's own: a person reading
     * "which days did I not get food" is owed the kitchen's skips and the
     * allergen rule's as much as their own.
     *
     * @param  list<string>  $ids
     * @return array<string, list<string>>
     */
    private function skippedDates(array $ids): array
    {
        $rows = SubscriptionDelivery::query()
            ->whereIn('subscription_id', $ids)
            ->whereIn('status', [
                SubscriptionDeliveryStatus::SkippedCustomer->value,
                SubscriptionDeliveryStatus::SkippedNoSafeMeal->value,
                SubscriptionDeliveryStatus::SkippedUnavailable->value,
            ])
            ->orderBy('delivery_date')
            ->get(['subscription_id', 'delivery_date']);

        $dates = [];

        foreach ($rows as $row) {
            $dates[(string) $row->subscription_id][] = $row->delivery_date->toDateString();
        }

        return $dates;
    }

    /**
     * The dishes the customer chose for themselves, distinct.
     *
     * `source = customer` only. A `kitchen_default` row is what nobody chose and
     * a `substituted` one is what the kitchen sent instead; presenting either as
     * a choice would tell somebody they picked a meal they did not.
     *
     * @param  list<string>  $ids
     * @return array<string, list<string>>
     */
    private function chosenMealIds(array $ids): array
    {
        $rows = SubscriptionMealChoice::query()
            ->whereIn('subscription_id', $ids)
            ->where('source', MealChoiceSource::Customer->value)
            ->get(['subscription_id', 'catalogue_item_id']);

        $chosen = [];

        foreach ($rows as $row) {
            $subscriptionId = (string) $row->subscription_id;
            $itemId = (string) $row->catalogue_item_id;

            if (! in_array($itemId, $chosen[$subscriptionId] ?? [], true)) {
                $chosen[$subscriptionId][] = $itemId;
            }
        }

        return $chosen;
    }
}
