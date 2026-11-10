<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Orders\Contracts\PlanDayListing;
use Healthy360\Subscriptions\Models\Subscription;

/**
 * The subscriptions module's answer to the order desk's `PlanDayListing`.
 *
 * Built on {@see SubscriptionMealDemandAdapter}, which already reads exactly
 * the days that are not orders yet — claimed and projected, with the generated
 * ones left out — and the meal choices standing against them. This class only
 * gathers that one day by subscriber and names the plan and each dish.
 *
 * Every read is organisation-scoped and two queries wide whatever the day
 * holds: the subscriptions' owners, then every plan and dish name at once.
 */
final readonly class PlanDayListingAdapter implements PlanDayListing
{
    public function __construct(private SubscriptionMealDemandAdapter $demand) {}

    public function forDay(string $organisationId, CarbonImmutable $date, ?string $branchId = null): array
    {
        $day = $date->startOfDay();
        $window = $this->demand->forWindow($organisationId, $day, $day, $branchId);

        if ($window['days'] === []) {
            return [];
        }

        $subscriptionIds = array_values(array_unique(array_column($window['days'], 'subscription_id')));

        $owners = Subscription::query()
            ->where('organisation_id', $organisationId)
            ->whereKey($subscriptionIds)
            ->pluck('customer_account_id', 'id')
            ->all();

        $itemIds = array_values(array_unique([
            ...array_column($window['days'], 'plan_catalogue_item_id'),
            ...array_column($window['choices'], 'catalogue_item_id'),
        ]));

        $names = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('id', $itemIds)
            ->get(['id', 'name_en', 'name_ar'])
            ->keyBy(static fn (CatalogueItem $item): string => (string) $item->getKey());

        $choicesBySubscription = [];

        foreach ($window['choices'] as $choice) {
            $item = $names->get($choice['catalogue_item_id']);
            $choicesBySubscription[$choice['subscription_id']][] = [
                'slot' => $choice['slot'],
                'sequence' => $choice['sequence'],
                'catalogue_item_id' => $choice['catalogue_item_id'],
                'name_en' => $item?->name_en,
                'name_ar' => $item?->name_ar,
            ];
        }

        $rows = [];

        foreach ($window['days'] as $entry) {
            $plan = $names->get($entry['plan_catalogue_item_id']);
            $meals = $choicesBySubscription[$entry['subscription_id']] ?? [];

            usort($meals, static fn (array $left, array $right): int => [$left['slot'], $left['sequence']] <=> [$right['slot'], $right['sequence']]);

            $rows[] = [
                'subscription_id' => $entry['subscription_id'],
                'customer_account_id' => (string) ($owners[$entry['subscription_id']] ?? ''),
                'basis' => $entry['basis'],
                'plan_name_en' => $plan?->name_en,
                'plan_name_ar' => $plan?->name_ar,
                'meals_per_day' => $entry['meals_per_day'],
                'snacks_per_day' => $entry['snacks_per_day'],
                'meals' => $meals,
            ];
        }

        return $rows;
    }
}
