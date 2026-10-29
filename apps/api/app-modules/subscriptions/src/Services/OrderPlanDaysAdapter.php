<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Healthy360\Catalogues\Services\PlanSittings;
use Healthy360\Orders\Contracts\OrderPlanDays;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;

/**
 * The subscriptions module's answer to the order view's "which meal is for
 * which sitting" — read from the delivery row that names the order and the
 * customer's choices for that date.
 *
 * Choices are frozen once a day is generated (`MealChoiceService` refuses a
 * settled day, and substitution rewrites the row before the order is placed),
 * so what this reads is what was packed. Two queries for any number of orders.
 */
final readonly class OrderPlanDaysAdapter implements OrderPlanDays
{
    /**
     * @param  list<string>  $orderIds
     * @return array<string, list<array{slot: string, sequence: int, catalogue_item_id: string, source: string}>>
     */
    public function forOrders(array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        $deliveries = SubscriptionDelivery::query()
            ->whereIn('order_id', $orderIds)
            ->get(['subscription_id', 'delivery_date', 'order_id']);

        if ($deliveries->isEmpty()) {
            return [];
        }

        $choices = SubscriptionMealChoice::query()
            ->whereIn('subscription_id', $deliveries->pluck('subscription_id')->unique()->values()->all())
            ->whereIn('delivery_date', $deliveries->map(static fn (SubscriptionDelivery $delivery): string => $delivery->delivery_date->toDateString())->unique()->values()->all())
            ->get(['subscription_id', 'delivery_date', 'slot', 'sequence', 'catalogue_item_id', 'source'])
            ->groupBy(static fn (SubscriptionMealChoice $choice): string => $choice->subscription_id.'|'.$choice->delivery_date->toDateString());

        $days = [];

        foreach ($deliveries as $delivery) {
            $meals = [];

            foreach ($choices->get($delivery->subscription_id.'|'.$delivery->delivery_date->toDateString(), []) as $choice) {
                $meals[] = [
                    'slot' => $choice->slot,
                    'sequence' => $choice->sequence,
                    'catalogue_item_id' => $choice->catalogue_item_id,
                    'source' => $choice->source->value,
                ];
            }

            usort($meals, static fn (array $left, array $right): int => [array_search($left['slot'], PlanSittings::SLOTS, true), $left['sequence']]
                <=> [array_search($right['slot'], PlanSittings::SLOTS, true), $right['sequence']]);

            $days[(string) $delivery->order_id] = $meals;
        }

        return $days;
    }
}
