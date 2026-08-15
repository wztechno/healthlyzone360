<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Enums;

/**
 * What became of one scheduled delivery day.
 *
 * **This enum is where the balance actually lives.** The approved semantics
 * (§1) make a subscription a consumable balance of delivery days, and
 * `subscriptions.balance_days_consumed` is a cached count of the rows here that
 * consumed one. Six statuses rather than a boolean because "the customer
 * skipped it", "the kitchen had nothing safe to send" and "the order was
 * cancelled after it was placed" are three different facts about the same day,
 * and the second one in particular is a promise the platform makes: a slot with
 * no allergen-safe meal is skipped *without consuming a day* (§6), which is
 * only auditable if the row says so in its own words.
 *
 * `scheduled` is generation's **claim**: the row is written, and the unique
 * index on `(subscription_id, delivery_date)` taken, before the order is
 * placed. That is the same ordering `OrderIdempotency` uses for the same
 * reason — a check-then-act is something two hourly ticks on two application
 * servers can both pass. Future days are deliberately *not* materialised in
 * this state; §4 makes generation incremental, and a customer's balance view
 * reads its upcoming dates from `ScheduleProjection`, which computes them
 * without writing anything.
 *
 * `skipped_unavailable` is the day the kitchen could not serve for a reason
 * that is nobody's fault and not about allergens: the cut-off passed while the
 * tick was running, the plan was withdrawn from the channel, the branch closed
 * that weekday. It is a separate status from `skipped_no_safe_meal` because the
 * customer is owed a different sentence and the kitchen a different report, and
 * because conflating them would make the allergen-safety record — the one that
 * matters in a complaint — impossible to count.
 */
enum SubscriptionDeliveryStatus: string
{
    case Scheduled = 'scheduled';
    case Generated = 'generated';
    case SkippedCustomer = 'skipped_customer';
    case SkippedNoSafeMeal = 'skipped_no_safe_meal';
    case SkippedUnavailable = 'skipped_unavailable';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    /**
     * Whether a day in this state takes one off the balance.
     *
     * Only a generated or delivered day does. A skip of either kind is free —
     * the customer's own skip by §2, the unsafe-meal skip by §6 — and a
     * cancelled order gives the day back, which is what the reconciliation pass
     * in `GenerationService` exists to do.
     */
    public function consumes(): bool
    {
        return $this === self::Generated || $this === self::Delivered;
    }

    /** Whether generation has already dealt with this row. */
    public function isSettled(): bool
    {
        return $this !== self::Scheduled;
    }
}
