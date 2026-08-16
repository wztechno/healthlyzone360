<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Contracts;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Services\NullSubscriptionMealDemand;

/**
 * The seam through which the requirement forecast learns what a kitchen has
 * promised to cook for its subscribers but has not yet turned into an order.
 *
 * Inventory declares the question; it never learns who answers it. The forecast
 * lives here because the half nobody can move lives here — `MealExplosion`,
 * `stock_items`, `stock_levels` and `par_level` are this module's own rows — and
 * the two other demand populations it needs are already reachable: `order_lines`
 * over the declared Inventory → Orders edge, and `plan_menu_entries` over
 * Inventory → Catalogues. Subscriptions is the one book it may not open. So this
 * is an ordinary port, the mirror image of `OrderStockConsumption`:
 * `InventoryServiceProvider` binds {@see NullSubscriptionMealDemand}
 * as a default, and the subscriptions module binds the real implementation over
 * it from its own `boot()`.
 *
 * **A deployment without subscriptions gets an honest forecast of its real
 * orders** rather than a missing endpoint or a container error. A kitchen that
 * sells no standing arrangements buys for the orders it has taken, and that is
 * the whole truth about it.
 *
 * ## One method, because the projection may be run once
 *
 * The days and the choices on them come back together on purpose, for the reason
 * `SubscriptionOutlook` gives about the same underlying machinery: half of this
 * answer is `ScheduleProjection`, which is O(subscriptions × days) with a query
 * per subscription. Two methods would invite two runs, and no docblock on a
 * calling service can prevent that the way a one-method interface can.
 *
 * ## What is deliberately **not** in here
 *
 * **Days that have already become orders.** A generated subscription day is a
 * row in `orders` with real meal lines on it, and the forecast counts those on
 * its first population. Returning the day here as well would count one Tuesday's
 * chicken twice and send a buyer out for double. The implementations answer only
 * for days no order exists for yet — the same predicate `SubscriptionOutlook`
 * uses for its `scheduled` basis, and by construction for its `projected` one.
 *
 * **Any resolution of what a slot will contain when nobody has chosen.** That is
 * the plan's menu, which lives in Catalogues, which the forecast can read for
 * itself — and must, because the same read has to record *why* a slot could not
 * be resolved (`plan_has_no_menu`, a withdrawn dish) in the forecast's own
 * vocabulary. A port that pre-resolved it would put half the reason taxonomy on
 * the far side of the seam.
 */
interface SubscriptionMealDemand
{
    /**
     * Every subscription day in this window that is not already an order, and
     * every meal choice standing against those days.
     *
     * `days` is one entry per subscription per day, carrying the plan so the
     * caller can read its menu, and the basis so a caller that wants to weigh a
     * claim differently from a forecast still can. `choices` is flat rather than
     * nested under its day because the caller tallies it as its own population
     * — a chosen dish is demand whether or not the menu also names one — and it
     * is restricted to the days in `days` for the double-counting reason above.
     *
     * `sequence` is an int and `slot` one of `breakfast|lunch|dinner|snack`,
     * the four words `subscription_meal_choices` and `plan_menu_entries` both
     * store; together with `delivery_date` and `subscription_id` they are the
     * coordinate a caller matches a menu entry against.
     *
     * @param  string|null  $branchId  narrow to one production site, or null for the whole organisation
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
    ): array;
}
