<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;

/**
 * Where `next_generation_date` may point, in one place.
 *
 * The cursor is the single column the hourly tick reads to decide which day
 * a subscription is on, and it is also what the customer sees as
 * `next_delivery_date`. Both readers need the same promise: **the cursor
 * names a day the subscription will actually deliver on.** That is two
 * conditions, not one — the weekday is in the subscription's pattern, *and*
 * the day has not already been settled away. A customer who skips the day
 * the cursor points at has not changed their weekdays, but they have made
 * that date undeliverable, and a cursor left pointing at it would tell them
 * their next delivery is the one they just cancelled.
 *
 * Generation used to own the weekday half of this rule privately and
 * `ChangeWindow` restated it for the change-window half. The skip case needs
 * both from a third caller, so the rule lives here and the three of them
 * share it rather than agreeing by coincidence.
 *
 * **What counts as settled away.** The three skip statuses and `cancelled`:
 * the row exists, nothing will be cooked for it, and generation's own tick
 * would step over it on sight. A `scheduled` or `generated` row is *not*
 * stepped over here — it is a delivery, and a cursor pointing at it is a
 * cursor pointing at the truth. Generation moves past those itself once it
 * has dealt with them, which is the only moment that is correct to do so.
 */
final readonly class DeliveryCursor
{
    /**
     * How far forward a walk looks before giving up. A subscription delivers
     * on at least one weekday — the table's CHECK guarantees it — so the only
     * thing that can push the answer past a week is a run of skipped days,
     * and ten weeks of them is a subscription nobody is using.
     */
    private const int HORIZON_DAYS = 70;

    /** The statuses that make a date undeliverable without making it a delivery. */
    private const array SETTLED_AWAY = [
        SubscriptionDeliveryStatus::SkippedCustomer,
        SubscriptionDeliveryStatus::SkippedNoSafeMeal,
        SubscriptionDeliveryStatus::SkippedUnavailable,
        SubscriptionDeliveryStatus::Cancelled,
    ];

    /**
     * The first deliverable day on or after `$from`.
     *
     * A day is deliverable when the subscription delivers on its weekday and
     * no row has already settled it away. `$accept` lets a caller add a third
     * condition — `ChangeWindow` asks that the day's change window still be
     * open — without restating the first two.
     *
     * @param  (callable(CarbonImmutable): bool)|null  $accept
     */
    public function firstDeliverableDate(Subscription $subscription, CarbonImmutable $from, ?callable $accept = null): CarbonImmutable
    {
        $start = $from->startOfDay();
        $blocked = $this->settledAwayDates($subscription, $start, $start->addDays(self::HORIZON_DAYS));

        for ($offset = 0; $offset <= self::HORIZON_DAYS; $offset++) {
            $day = $start->addDays($offset);

            if (! $subscription->deliversOnWeekday($day->dayOfWeekIso)) {
                continue;
            }

            if (isset($blocked[$day->toDateString()])) {
                continue;
            }

            if ($accept !== null && ! $accept($day)) {
                continue;
            }

            return $day;
        }

        return $start->addDays(self::HORIZON_DAYS + 1);
    }

    /**
     * Move the cursor to the first deliverable day *after* `$from`, and save.
     *
     * Strictly after: the caller has just dealt with `$from` — generated it,
     * found it already settled, or skipped it — and is asking what comes next.
     */
    public function advance(Subscription $subscription, CarbonImmutable $from): void
    {
        $subscription->next_generation_date = $this->firstDeliverableDate($subscription, $from->addDay());
        $subscription->save();
    }

    /**
     * The dates in a range already settled away, as a set.
     *
     * An unsaved subscription — the one a quote builds to ask where a plan
     * could start — has no rows and is answered without a query.
     *
     * @return array<string, true>
     */
    private function settledAwayDates(Subscription $subscription, CarbonImmutable $from, CarbonImmutable $to): array
    {
        if (! $subscription->exists) {
            return [];
        }

        $rows = SubscriptionDelivery::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereIn('status', array_map(
                static fn (SubscriptionDeliveryStatus $status): string => $status->value,
                self::SETTLED_AWAY,
            ))
            ->whereBetween('delivery_date', [$from->toDateString(), $to->toDateString()])
            ->get(['delivery_date']);

        $dates = [];

        foreach ($rows as $row) {
            $dates[$row->delivery_date->toDateString()] = true;
        }

        return $dates;
    }
}
