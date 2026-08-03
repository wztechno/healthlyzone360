<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Presenters;

use Healthy360\Subscriptions\Models\CreditMemo;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;

/**
 * The wire shapes of a standing arrangement.
 *
 * **`customer()` and `schedule()` are built independently**, the rule
 * `OrderPresenter` states: a narrow shape produced by unsetting keys from a
 * wide one is one careless refactor away from leaking, because a column added
 * to the wide array reaches the narrow one unless somebody remembers the
 * subtraction list. Here a field reaches a kitchen only if somebody writes it
 * into the kitchen method.
 *
 * ## What the customer is shown, and what they are not
 *
 * The **captured price is shown to the customer** — all three columns of it.
 * `Subscription` classifies them `Confidential`, which is a statement about
 * *other* readers: what one customer was grandfathered at is not what the plan
 * costs today, and publishing it would advertise a price nobody else can have.
 * The person paying it is not another reader. Showing `captured_unit_price`
 * beside `effective_day_price` is what makes "why am I paying 1 800 when the
 * plan says 2 000" answerable on the screen instead of through support.
 *
 * They are **not** shown `captured_price_list_id` or
 * `captured_price_list_item_id`, for the reason `OrderPresenter` withholds the
 * same pair: the provenance exists so the platform can explain a price years
 * later, and on a customer's own screen it names a kitchen's tariff structure
 * to the person being charged by it. Nor `organisation_id`, `created_by` or
 * `updated_by` — the seller's internal key and the staff who touched the row.
 *
 * `lock_version` **is** shown, unlike on the customer's order shape, and the
 * difference is that this resource has a customer-facing writer. Pause, resume,
 * skip and the three replacements all accept `If-Match`, so a validator here is
 * something the client can act on rather than an invitation to send a header at
 * an endpoint that ignores it.
 *
 * ## The kitchen shape
 *
 * `schedule()` serves `ScheduleProjection`'s rows and adds nothing to them. It
 * carries no customer name, no address and no allergen list: a production
 * planner counts portions per window per day, and every one of those fields
 * would be personal data on a screen that does not need it. The
 * `customer_account_id` travels because a kitchen chasing one delivery has to
 * be able to open it on a surface that *does* have the purpose-of-use path.
 */
final class SubscriptionPresenter
{
    /**
     * A customer's own subscription.
     *
     * @param  array<string, mixed>|null  $balance  `SubscriptionService::balance()`, when the caller asked for it
     * @return array<string, mixed>
     */
    public function customer(Subscription $subscription, ?array $balance = null): array
    {
        $shape = [
            'id' => (string) $subscription->getKey(),
            'status' => $subscription->status->value,

            'catalogue_item_id' => $subscription->catalogue_item_id,
            'catalogue_item_variant_id' => $subscription->catalogue_item_variant_id,
            'plan_duration_id' => $subscription->plan_duration_id,
            'sales_channel_id' => $subscription->sales_channel_id,

            'currency_code' => $subscription->currency_code,
            'captured_unit_price_minor' => $subscription->captured_unit_price_minor,
            'captured_discount_percent' => $subscription->captured_discount_percent,
            'effective_day_price_minor' => $subscription->effective_day_price_minor,
            'captured_at' => $subscription->captured_at->toIso8601String(),

            'weekdays' => array_map(intval(...), $subscription->weekdays),
            'delivery_window_code' => $subscription->delivery_window_code,
            'customer_address_id' => $subscription->customer_address_id,
            'no_substitutions' => $subscription->no_substitutions,

            'balance_days_total' => $subscription->balance_days_total,
            'balance_days_consumed' => $subscription->balance_days_consumed,
            'remaining_days' => $subscription->remainingDays(),
            'next_delivery_date' => $subscription->next_generation_date?->toDateString(),

            'paused_at' => $subscription->paused_at?->toIso8601String(),
            'resumed_at' => $subscription->resumed_at?->toIso8601String(),
            'pause_count' => $subscription->pause_count,
            'cancelled_at' => $subscription->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $subscription->cancellation_reason,
            'completed_at' => $subscription->completed_at?->toIso8601String(),

            'lock_version' => $subscription->lock_version,
            'created_at' => $subscription->created_at?->toIso8601String(),
        ];

        if ($balance !== null) {
            $shape['balance'] = $balance;
        }

        return $shape;
    }

    /**
     * One day of the ledger.
     *
     * `consumed` travels beside `status` rather than being derived from it,
     * because the model says it must be: whether a day was spent is a stored
     * fact, and a client recomputing it from the status would eventually
     * disagree with the balance.
     *
     * @param  iterable<int, SubscriptionMealChoice>  $choices
     * @return array<string, mixed>
     */
    public function delivery(SubscriptionDelivery $delivery, iterable $choices = []): array
    {
        $meals = [];

        foreach ($choices as $choice) {
            $meals[] = [
                'slot' => $choice->slot,
                'sequence' => $choice->sequence,
                'catalogue_item_id' => $choice->catalogue_item_id,
                'catalogue_item_variant_id' => $choice->catalogue_item_variant_id,
                'source' => $choice->source->value,
                // What the original was, when generation replaced it. The
                // customer is owed the difference between "you chose this" and
                // "we sent this instead", which is the §6 substitution promise.
                'replaced_catalogue_item_id' => $choice->replaced_catalogue_item_id,
            ];
        }

        return [
            'id' => (string) $delivery->getKey(),
            'delivery_date' => $delivery->delivery_date->toDateString(),
            'delivery_window_code' => $delivery->delivery_window_code,
            'status' => $delivery->status->value,
            'consumed' => $delivery->consumed,
            'skip_reason' => $delivery->skip_reason,
            'order_id' => $delivery->order_id,
            'generated_at' => $delivery->generated_at?->toIso8601String(),
            'settled_at' => $delivery->settled_at?->toIso8601String(),
            'meals' => $meals,
        ];
    }

    /**
     * A recorded refund.
     *
     * `settlement: manual` is stated on the wire rather than left to be
     * inferred from the status vocabulary. It is the one sentence a customer
     * cancelling most needs — no money has moved, and somebody will be in touch
     * — and a client that had to know `recorded` meant that would eventually
     * render it as "refunded".
     *
     * @return array<string, mixed>
     */
    public function creditMemo(CreditMemo $memo): array
    {
        return [
            'id' => (string) $memo->getKey(),
            'reason' => $memo->reason,
            'unused_days' => $memo->unused_days,
            'per_day_minor' => $memo->per_day_minor,
            'amount_minor' => $memo->amount_minor,
            'currency_code' => $memo->currency_code,
            'status' => $memo->status->value,
            'settlement' => 'manual',
            'recorded_at' => $memo->recorded_at->toIso8601String(),
            'settled_at' => $memo->settled_at?->toIso8601String(),
        ];
    }

    /**
     * One row of the kitchen's forward view.
     *
     * A pass-through of `ScheduleProjection`'s own shape. It is presented at
     * all — rather than the projection being serialised directly — so that this
     * class stays the single place a field could be added to a kitchen-facing
     * subscription payload, which is where somebody looks before adding one.
     *
     * @param  array{
     *     delivery_date: string,
     *     subscription_id: string,
     *     customer_account_id: string,
     *     branch_id: string|null,
     *     delivery_window_code: string|null,
     *     basis: string,
     *     status: string,
     * }  $row
     * @return array<string, mixed>
     */
    public function scheduleRow(array $row): array
    {
        return [
            'delivery_date' => $row['delivery_date'],
            'subscription_id' => $row['subscription_id'],
            'customer_account_id' => $row['customer_account_id'],
            'branch_id' => $row['branch_id'],
            'delivery_window_code' => $row['delivery_window_code'],
            // `actual` or `projected`. A kitchen planning production needs both
            // and must never confuse them: an actual day has an order behind it
            // and a projected one is a customer who has not yet had the chance
            // to skip.
            'basis' => $row['basis'],
            'status' => $row['status'],
        ];
    }
}
