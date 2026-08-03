<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Subscriptions\Models\CreditMemo;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Services\ChangeWindow;

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
     * ## The named facts, and why they belong here
     *
     * The row is a row of identifiers, which is the right shape for a table and
     * the wrong one for the screen where somebody cancels something. A customer
     * looking at their own subscription is owed its plan's name, the kitchen
     * that cooks it, the address it goes to and the run they bought — and the
     * only reason those were ever absent was **projection thinness, not
     * confidentiality**. Nothing here is withheld from its owner because it is
     * sensitive; it was withheld because nobody had joined it yet.
     *
     * `SubscriptionProjection` does the joining, batched, so the unpaginated
     * list read stays a fixed number of queries. `$facts` is what it gathered;
     * an empty array degrades to the identifiers alone rather than to a fatal,
     * because a presenter is not the place to discover a missing join.
     *
     * ## What stays out
     *
     * `captured_price_list_id` and `captured_price_list_item_id` — the
     * provenance a capture keeps so a price stays explainable years later, and
     * on a customer's screen a name for the kitchen's tariff structure to the
     * person being charged by it. `organisation_id`, `created_by`, `updated_by`
     * — the seller's internal key and the staff who touched the row; the
     * kitchen travels as `kitchen`, which is a *fact about the food*, not the
     * tenant key. `branch_id`, on the terms `OrderPresenter` states: the
     * kitchen's operating arrangements are not the customer's business. And the
     * sales channel's **name**, because `SalesChannel` is classified `Internal`
     * — the identifier already travels because generation prices against it.
     *
     * @param  array<string, mixed>|null  $balance  `SubscriptionService::balance()`, when the caller asked for it
     * @param  array<string, mixed>  $facts  `SubscriptionProjection::for()`, when the caller gathered them
     * @param  string  $locale  the language the names are served in (§4.8)
     * @return array<string, mixed>
     */
    public function customer(
        Subscription $subscription,
        ?array $balance = null,
        array $facts = [],
        string $locale = 'en',
    ): array {
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
            'updated_at' => $subscription->updated_at?->toIso8601String(),
        ];

        if ($facts !== []) {
            $shape += $this->namedFacts($subscription, $facts, $locale);
        }

        if ($balance !== null) {
            $shape['balance'] = $balance;
        }

        return $shape;
    }

    /**
     * The joined half of the shape.
     *
     * Split out so `customer()` stays readable and so the "what is a fact about
     * the food" boundary has one place to be argued about.
     *
     * `weekly_price_minor` is arithmetic on two numbers already on the wire —
     * the effective per-day price and the count of delivery weekdays — and not a
     * new fact. It is served rather than left to the client because a client
     * dividing or multiplying a price is a second implementation of the rule
     * that decides what somebody pays, and the two would eventually disagree
     * about a plan that delivers three days a week.
     *
     * @param  array<string, mixed>  $facts
     * @return array<string, mixed>
     */
    private function namedFacts(Subscription $subscription, array $facts, string $locale): array
    {
        $plan = $facts['plan'] ?? null;
        $variant = $facts['variant'] ?? null;
        $duration = $facts['duration'] ?? null;
        $profile = $facts['profile'] ?? null;
        $kitchen = $facts['kitchen'] ?? null;
        $address = $facts['address'] ?? null;

        $weekdayCount = count($subscription->weekdays);

        return [
            'plan' => $plan instanceof CatalogueItem ? [
                'id' => (string) $plan->getKey(),
                'name' => SubscriptionLocale::pick($locale, $plan->name_en, $plan->name_ar),
                'slug' => $plan->slug,
            ] : null,

            // `kitchen`, never `organisation` — the established name on every
            // customer-facing shape, and the one the smoke test pins as absent
            // at the top level.
            'kitchen' => $kitchen instanceof Organisation ? [
                'id' => (string) $kitchen->getKey(),
                // A business name is not translated: `organisations.name` is a
                // single column and is served as it was registered, whatever
                // `Accept-Language` says.
                'name' => $kitchen->name,
            ] : null,

            'configuration' => $variant instanceof CatalogueItemVariant ? [
                'id' => (string) $variant->getKey(),
                'code' => $variant->code,
                'name' => SubscriptionLocale::pick($locale, $variant->name_en, $variant->name_ar),
            ] : null,

            // `kind` and `days` rather than a derived label. The run bought is
            // the duration's own day count and never `balance_days_total`,
            // which counts *delivery* days: a four-week plan delivering five
            // weekdays buys twenty of them, not twenty-eight.
            'duration' => $duration instanceof PlanDuration ? [
                'id' => (string) $duration->getKey(),
                'code' => $duration->code,
                'kind' => $duration->duration_kind->value,
                'days' => $duration->duration_days,
                'name' => SubscriptionLocale::pick($locale, $duration->name_en, $duration->name_ar),
            ] : null,

            // The whole address, to the person who typed it. `CustomerAddressPresenter`
            // states the reason: a masked address book is a screen on which
            // nobody can tell which address is which.
            'delivery_address' => $address instanceof CustomerAddress ? [
                'id' => (string) $address->getKey(),
                'label' => $address->label,
                'line_one' => $address->line_one,
                'line_two' => $address->line_two,
                'building' => $address->building,
                'floor' => $address->floor,
                'apartment' => $address->apartment,
                'directions' => $address->directions,
                'delivery_area_id' => $address->delivery_area_id,
            ] : null,

            'starts_on' => $facts['started_on'] ?? null,
            'weekly_price_minor' => $subscription->effective_day_price_minor * $weekdayCount,

            'allows_free_selection' => $profile instanceof SubscriptionPlanProfile
                ? $profile->allows_free_selection
                : false,
            'change_cutoff_hours' => $profile instanceof SubscriptionPlanProfile
                ? $profile->change_cutoff_hours
                : ChangeWindow::DEFAULT_CUTOFF_HOURS,

            'skipped_dates' => $facts['skipped_dates'] ?? [],
            // What the customer chose for themselves, distinct — never the
            // kitchen's defaults or its substitutions.
            'chosen_catalogue_item_ids' => $facts['chosen_catalogue_item_ids'] ?? [],
        ];
    }

    /**
     * One chosen dish.
     *
     * **`name` is server-derived, always.** The client sends a
     * `catalogue_item_id` and never a display name, which is the only defensible
     * arrangement on a surface this close to safety: a caller-supplied label
     * could disagree with the dish actually recorded, and the screen that showed
     * it would be describing food nobody is going to cook. It is resolved from
     * the catalogue in the caller's language and falls back to the empty string
     * for an item that has since been removed — an honest blank rather than a
     * stale name kept alive by a client.
     *
     * @param  array<string, string>  $mealNames
     * @return array<string, mixed>
     */
    public function mealChoice(SubscriptionMealChoice $choice, array $mealNames = []): array
    {
        return [
            'slot' => $choice->slot,
            'sequence' => $choice->sequence,
            'catalogue_item_id' => $choice->catalogue_item_id,
            'catalogue_item_variant_id' => $choice->catalogue_item_variant_id,
            'name' => $mealNames[$choice->catalogue_item_id] ?? '',
            'source' => $choice->source->value,
            // What the original was, when generation replaced it. The customer
            // is owed the difference between "you chose this" and "we sent this
            // instead", which is the §6 substitution promise.
            'replaced_catalogue_item_id' => $choice->replaced_catalogue_item_id,
            'replaced_name' => $choice->replaced_catalogue_item_id === null
                ? null
                : ($mealNames[$choice->replaced_catalogue_item_id] ?? ''),
        ];
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
     * @param  array<string, string>  $mealNames  catalogue item id → the dish's name, already localised
     * @return array<string, mixed>
     */
    public function delivery(
        SubscriptionDelivery $delivery,
        iterable $choices = [],
        array $mealNames = [],
    ): array {
        $meals = [];

        foreach ($choices as $choice) {
            $meals[] = $this->mealChoice($choice, $mealNames);
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
