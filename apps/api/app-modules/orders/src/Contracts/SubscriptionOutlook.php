<?php

declare(strict_types=1);

namespace Healthy360\Orders\Contracts;

use Carbon\CarbonImmutable;

/**
 * The seam through which the order desk's calendar learns what a kitchen owes
 * that nobody has placed an order for yet (C4).
 *
 * Orders declares the question; it never learns who answers it. The dependency
 * edge the module registry asserts runs *toward* orders — Subscriptions →
 * Orders, because generation places a real order through
 * `OrderPlacementService::placeComposed()` — so a reverse call, orders reaching
 * into subscriptions, would be the cycle the architecture test forbids. Instead
 * this is an ordinary port, the fourth on this module and the third of its
 * shape: orders states what it needs, `OrdersServiceProvider` binds a null
 * default so the calendar still answers with no subscriptions module present,
 * and the subscriptions module binds the real implementation over that default
 * from its own `boot()` (`OrderStockConsumption` and `DeliveryJobProjection`
 * are the template, two files over).
 *
 * **A deployment without subscriptions gets an honest, empty calendar** rather
 * than a missing endpoint or a container error. A kitchen that sells no standing
 * arrangements has no forward book beyond its real orders, and two empty lists
 * is exactly the truth about it.
 *
 * ## One method, because the projection may be run once
 *
 * Both non-order bases are answered in a single call on purpose. The projection
 * behind the second one is O(subscriptions × days) with a query per
 * subscription, and the surface that already exists runs it **twice** per
 * request. Splitting this into `scheduledDays()` and `projectedDays()` would
 * invite exactly that, and no docblock on a calling controller can prevent it
 * the way a one-method interface can.
 *
 * ## The two bases mean different things and are never one number
 *
 * `scheduled` is a **claim**: a `subscription_deliveries` row that exists, whose
 * day the generator has taken the unique index for and has not yet placed an
 * order against. It is a fact in a table.
 *
 * `projected` is a **forecast**: a day computed from an active subscription's
 * weekday pattern and remaining balance, which no row anywhere asserts. It is
 * optimistic by construction — the projection reads weekdays and balances and
 * does not consult `next_generation_date`, so after an outage, when generation
 * is catching up one delivery per tick, it still shows the pattern the customer
 * bought rather than the backlog the kitchen is actually working. A caller that
 * added it to anything would be adding a forecast to a fact, which is why the
 * calendar keeps all three of its bases apart and publishes no total.
 *
 * Skipped days are **not** deliveries and appear in neither list: a slot the
 * customer skipped, or one the kitchen had nothing safe to send for, is food
 * nobody is cooking.
 */
interface SubscriptionOutlook
{
    /**
     * Every subscription day in this window that is not already a real order,
     * split by which of the two things it is.
     *
     * Both lists are flat — one entry per day per subscription, carrying only
     * the day and the slot it falls in — because the caller buckets all three
     * of its bases through one rule and a pre-counted answer would put half of
     * that rule on this side of the seam.
     *
     * @param  string|null  $branchId  narrow to one production site, or null for the whole organisation
     * @return array{
     *     scheduled: list<array{delivery_date: string, delivery_window_code: string|null}>,
     *     projected: list<array{delivery_date: string, delivery_window_code: string|null}>,
     * }
     */
    public function forWindow(
        string $organisationId,
        CarbonImmutable $from,
        CarbonImmutable $to,
        ?string $branchId = null,
    ): array;
}
