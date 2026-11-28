<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Carbon\CarbonImmutable;

/**
 * One day's plan meals that are not orders yet, each with the dishes its
 * subscriber has picked — the order desk's port onto the subscriptions module.
 *
 * A plan day is an order that has not been made: the generator turns it into
 * a real order a day ahead, and until then the kitchen sees it here, by
 * customer, with what they chose. Days already generated are absent — their
 * order is on the book, and listing them twice would cook them twice.
 *
 * `basis` is `scheduled` (claimed by the generator, no order yet) or
 * `projected` (the plan's weekdays say it is coming). Both are orders not yet
 * made; the second is also not yet certain, and the screen says so.
 *
 * Bound to `NullPlanDayListing` by the orders module and overridden in
 * `SubscriptionsServiceProvider::boot()`, as `SubscriptionOutlook` is.
 */
interface PlanDayListing
{
    /**
     * @return list<array{
     *     subscription_id: string,
     *     customer_account_id: string,
     *     basis: string,
     *     plan_name_en: string|null,
     *     plan_name_ar: string|null,
     *     meals_per_day: int|null,
     *     snacks_per_day: int|null,
     *     meals: list<array{slot: string, sequence: int, catalogue_item_id: string, name_en: string|null, name_ar: string|null}>,
     * }>
     */
    public function forDay(string $organisationId, CarbonImmutable $date, ?string $branchId = null): array;
}
