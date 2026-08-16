<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Contracts\SubscriptionMealDemand;

/**
 * The answer when no subscriptions module is installed: a requirement forecast
 * built from the kitchen's real orders and nothing else.
 *
 * Bound by `InventoryServiceProvider` and replaced by the subscriptions module's
 * real adapter when that module is present. The null object exists so the
 * forecast keeps working — and keeps being testable — without subscriptions,
 * rather than resolving to an unbound interface and failing at the container the
 * first time somebody asks what to buy.
 *
 * Two empty lists are the **honest** answer rather than a degraded one, and in
 * particular they are not a hole: a deployment that sells no standing
 * arrangements has no subscription demand to be unable to compute, so nothing
 * lands in `not_computable` either. The forecast is complete; it is just short.
 */
final class NullSubscriptionMealDemand implements SubscriptionMealDemand
{
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
        return ['days' => [], 'choices' => []];
    }
}
