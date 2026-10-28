<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Subscriptions\Contracts\MealSafety;
use Healthy360\Subscriptions\Enums\MealChoiceSource;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Identifiers\IdentifierService;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * The hourly tick that turns a schedule into real orders — one delivery ahead,
 * and never more.
 *
 * **Incremental, by §4.** Orders are generated as each delivery crosses its
 * change cut-off, not all in advance. Three things follow from that and all
 * three are the point: the kitchen's order list is truthful rather than full of
 * food nobody has committed to; a skip costs nothing because there is no order
 * to cancel; and a price change, an address change or a cancellation never has
 * to chase down twenty pre-created orders. Future demand is answered by
 * `ScheduleProjection`, which computes and writes nothing.
 *
 * **The row is claimed before the order is placed.** A `subscription_deliveries`
 * row goes in first, taking the unique index on `(subscription_id,
 * delivery_date)`; only then is the order placed. That ordering is deliberate
 * and it is the same one `OrderIdempotency` uses: two hourly ticks on two
 * application servers can both pass a check-then-act, and neither can win the
 * same unique index twice. The placement carries an idempotency key of its own
 * derived from the subscription and the date, so even a claim that is somehow
 * repeated cannot produce two orders.
 *
 * **What one generated day looks like.** One order, whose lines are:
 *
 *  * the plan configuration, at the **captured** per-day price (§5,
 *    grandfathered) — `PriceOverride` with `subscription_capture`;
 *  * each dish making up the day, at zero — `subscription_included` — so the
 *    kitchen has a picking list and the customer a record, without the total
 *    charging for the food twice.
 *
 * **The allergen gate runs before any of it.** Every dish is checked against
 * the customer's declarations and exclusions; an unsafe one is substituted
 * within the §6 rules or, failing that, the whole day is skipped **without
 * consuming a balance day** and an event is written for the notification layer
 * to pick up. The conservative reading is taken deliberately: §6 says an
 * unfillable slot is skipped without consuming a day, and since a day is the
 * unit of the balance, a day that cannot be filled safely is not delivered
 * partially and charged fully. A half-box for a full day would be the worst of
 * both readings.
 *
 * **The reconciliation pass gives days back.** A kitchen that cancels a
 * generated order has taken food away that the balance already paid for, so the
 * day is restored: `consumed` goes back to false, the counter comes down, and
 * `day_restored` is written to the subscription's own history. It is a sweep
 * rather than an event listener on purpose — a listener that is not registered,
 * or a queue that dropped a job, loses a day silently, whereas a sweep that
 * runs every hour converges. It is also idempotent by construction: it only
 * ever acts on rows whose stored `consumed` disagrees with their order's state.
 */
final readonly class GenerationService
{
    public function __construct(
        private OrderPlacementService $placement,
        private MealSafety $safety,
        private SubstitutionFinder $substitutions,
        private ChangeWindow $window,
        private DeliveryCursor $cursor,
        private RenewalService $renewals,
        private SubscriptionJournal $journal,
        private IdentifierService $identifiers,
        private TenantContext $context,
        private OrderSchedulingLookup $scheduling,
    ) {}

    /**
     * One tick: reconcile, then generate everything that has crossed its
     * boundary.
     *
     * @return array{reconciled: int, generated: int, skipped: int, completed: int}
     */
    public function tick(?CarbonImmutable $now = null): array
    {
        $at = $now ?? CarbonImmutable::now();

        $tally = ['reconciled' => $this->reconcile(), 'generated' => 0, 'skipped' => 0, 'completed' => 0];

        $due = Subscription::query()
            ->where('status', SubscriptionStatus::Active->value)
            ->whereNotNull('next_generation_date')
            ->orderBy('next_generation_date')
            ->orderBy('id')
            ->get();

        foreach ($due as $subscription) {
            $outcome = $this->advance($subscription, $at);

            $tally['generated'] += $outcome['generated'];
            $tally['skipped'] += $outcome['skipped'];
            $tally['completed'] += $outcome['completed'];
        }

        return $tally;
    }

    /**
     * Move one subscription forward by at most one delivery.
     *
     * "At most one" is the §4 rule made structural. A tick that caught up on a
     * backlog by generating four days at once would put four orders into a
     * kitchen that expected one, which is precisely the mass-creation the
     * incremental design exists to avoid.
     *
     * **Run as the subscriber, at their kitchen** — the context a customer's
     * own checkout runs in. The scheduler carries no tenant context, and the
     * runtime role holds NOBYPASSRLS, so without one the customer's account,
     * their consents and the dish's recipe version (where its allergen label
     * lives) all read as no row at all: every day was skipped
     * `customer_record_unreadable`, and placement would have refused
     * `account_not_ready` for consents it could not see. The kitchen is set
     * first, which the subscriber arm of `rls_customer_account_select` admits,
     * to learn whose login the account is; then the subscriber's own user is
     * added, which is what admits their consents. An account with no login (a
     * staff-provisioned one) runs as the kitchen alone.
     *
     * @return array{generated: int, skipped: int, completed: int}
     */
    public function advance(Subscription $subscription, CarbonImmutable $now): array
    {
        $previous = $this->context->toArray();

        try {
            $this->context->restore([
                'user_id' => null,
                'organisation_id' => $subscription->organisation_id,
                'branch_id' => $subscription->branch_id,
            ]);

            $subscriber = CustomerAccount::query()->whereKey($subscription->customer_account_id)->value('user_id');

            $this->context->restore([
                'user_id' => is_string($subscriber) ? $subscriber : null,
                'organisation_id' => $subscription->organisation_id,
                'branch_id' => $subscription->branch_id,
            ]);

            return $this->advanceAsKitchen($subscription, $now);
        } finally {
            $this->context->restore($previous);
        }
    }

    /**
     * @return array{generated: int, skipped: int, completed: int}
     */
    private function advanceAsKitchen(Subscription $subscription, CarbonImmutable $now): array
    {
        $none = ['generated' => 0, 'skipped' => 0, 'completed' => 0];

        if ($subscription->status !== SubscriptionStatus::Active) {
            return $none;
        }

        if ($subscription->isExhausted()) {
            $this->renewals->complete($subscription);

            return ['generated' => 0, 'skipped' => 0, 'completed' => 1];
        }

        $date = $subscription->next_generation_date;

        if ($date === null) {
            return $none;
        }

        $date = $date->startOfDay();

        // Not yet. The boundary is the change cut-off itself — the moment the
        // customer can no longer stop the delivery is the moment it becomes
        // real, which is what makes a skip free right up to the last second it
        // is offered.
        if ($this->window->isOpen($subscription, $date, $now)) {
            return $none;
        }

        $existing = SubscriptionDelivery::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $date->toDateString())
            ->first();

        if ($existing instanceof SubscriptionDelivery) {
            // The customer skipped it, or a previous tick settled it. Either
            // way the day is done; move the cursor and leave the row alone.
            $this->advanceCursor($subscription, $date);

            return $none;
        }

        $delivery = $this->claim($subscription, $date);

        if (! $delivery instanceof SubscriptionDelivery) {
            // Another process won the index. Its outcome is authoritative.
            return $none;
        }

        $outcome = $this->fulfil($subscription, $delivery, $date, $now);

        $this->advanceCursor($subscription, $date);

        if ($subscription->refresh()->isExhausted()) {
            $this->renewals->complete($subscription);
            $outcome['completed'] = 1;
        }

        return $outcome;
    }

    /**
     * Take the day, or discover somebody else has.
     */
    private function claim(Subscription $subscription, CarbonImmutable $date): ?SubscriptionDelivery
    {
        try {
            return DB::transaction(function () use ($subscription, $date): SubscriptionDelivery {
                $delivery = new SubscriptionDelivery;
                $delivery->subscription_id = (string) $subscription->getKey();
                $delivery->organisation_id = $subscription->organisation_id;
                $delivery->branch_id = $subscription->branch_id;
                $delivery->delivery_date = $date;
                $delivery->delivery_window_code = $subscription->delivery_window_code;
                $delivery->status = SubscriptionDeliveryStatus::Scheduled;
                $delivery->consumed = false;
                $delivery->save();

                return $delivery;
            });
        } catch (QueryException $exception) {
            // 23505 — unique violation. Losing this race is an expected
            // outcome, not a fault, and matched on the SQLSTATE rather than the
            // message for the reason `OrderIdempotency` gives.
            if ($exception->getCode() !== '23505') {
                throw $exception;
            }

            return null;
        }
    }

    /**
     * Resolve the day's food, check it is safe, and place the order.
     *
     * @return array{generated: int, skipped: int, completed: int}
     */
    private function fulfil(
        Subscription $subscription,
        SubscriptionDelivery $delivery,
        CarbonImmutable $date,
        CarbonImmutable $now,
    ): array {
        // The kitchen is shut that weekday. Placement refuses it too when the
        // subscription names a branch; this also covers one that does not, and
        // a day the kitchen closed after the customer chose it. Nothing is
        // consumed, so the balance carries to the next open day.
        if (in_array($date->dayOfWeekIso, $this->scheduling->closedWeekdays($subscription->organisation_id, $subscription->branch_id), true)) {
            $this->skipDay($subscription, $delivery, $date, SubscriptionDeliveryStatus::SkippedUnavailable, 'unavailable', [
                'reason' => 'kitchen_closed',
            ]);

            return ['generated' => 0, 'skipped' => 1, 'completed' => 0];
        }

        $account = CustomerAccount::query()->whereKey($subscription->customer_account_id)->first();
        $address = CustomerAddress::query()->whereKey($subscription->customer_address_id)->first();

        if (! $account instanceof CustomerAccount || ! $address instanceof CustomerAddress) {
            $this->skipDay($subscription, $delivery, $date, SubscriptionDeliveryStatus::SkippedUnavailable, 'unavailable', [
                'reason' => 'customer_record_unreadable',
            ]);

            return ['generated' => 0, 'skipped' => 1, 'completed' => 0];
        }

        [$meals, $unsafe] = $this->safeMealsFor($subscription, $account, $date, $now);

        if ($unsafe !== []) {
            // §6, absolute: no safe substitute means the day is skipped and the
            // balance is untouched. The event is what the notification layer
            // reads; nothing here sends anything.
            $this->skipDay($subscription, $delivery, $date, SubscriptionDeliveryStatus::SkippedNoSafeMeal, 'no_safe_meal', [
                'unsafe' => $unsafe,
            ]);

            return ['generated' => 0, 'skipped' => 1, 'completed' => 0];
        }

        $lines = [new ComposedLine(
            catalogueItemId: $subscription->catalogue_item_id,
            catalogueItemVariantId: $subscription->catalogue_item_variant_id,
            quantity: '1',
            price: new PriceOverride(
                unitPriceMinor: $subscription->effective_day_price_minor,
                currencyCode: $subscription->currency_code,
                source: PriceOverride::SUBSCRIPTION_CAPTURE,
            ),
        )];

        // One line per dish, not per sitting: `order_lines` is unique per
        // article, so a dish chosen for lunch and dinner is one line of two.
        $counts = [];

        foreach ($meals as $meal) {
            $counts[(string) $meal->getKey()] = ($counts[(string) $meal->getKey()] ?? 0) + 1;
        }

        foreach ($counts as $mealId => $count) {
            $lines[] = new ComposedLine(
                catalogueItemId: $mealId,
                catalogueItemVariantId: null,
                quantity: (string) $count,
                price: new PriceOverride(0, $subscription->currency_code, PriceOverride::SUBSCRIPTION_INCLUDED),
            );
        }

        try {
            $result = $this->placement->placeComposed(
                new ComposedPlacement(
                    account: $account,
                    address: $address,
                    organisationId: $subscription->organisation_id,
                    salesChannelId: $subscription->sales_channel_id,
                    branchId: $subscription->branch_id,
                    currencyCode: $subscription->currency_code,
                    lines: $lines,
                    deliveryWindowCode: $subscription->delivery_window_code,
                    requestedDate: $date,
                    // Owner decision: a map edit never starts refusing a
                    // standing subscriber's slot.
                    enforceWindowOffer: false,
                ),
                $this->idempotencyKeyFor($subscription, $date),
            );
        } catch (PlacementRefused|ApiException $refusal) {
            $this->skipDay($subscription, $delivery, $date, SubscriptionDeliveryStatus::SkippedUnavailable, 'unavailable', [
                'placement' => $refusal instanceof PlacementRefused ? ($refusal->details['reasons'] ?? []) : [],
            ]);

            return ['generated' => 0, 'skipped' => 1, 'completed' => 0];
        }

        $order = $result->order;

        DB::transaction(function () use ($subscription, $delivery, $order): void {
            $delivery->status = SubscriptionDeliveryStatus::Generated;
            $delivery->consumed = true;
            $delivery->order_id = (string) $order->getKey();
            $delivery->generated_at = CarbonImmutable::now();
            $delivery->settled_at = CarbonImmutable::now();
            $delivery->save();

            // The counter is the cache; the ledger row above is the truth. It
            // is incremented in the same transaction so the two cannot be
            // observed disagreeing.
            $subscription->balance_days_consumed = $subscription->balance_days_consumed + 1;
            $subscription->save();
        });

        $this->journal->record(
            $subscription,
            'delivery_generated',
            deliveryDate: $date,
            detail: [
                'order_number' => $order->order_number,
                'per_day_minor' => $subscription->effective_day_price_minor,
                'currency' => $subscription->currency_code,
                'meal_count' => count($meals),
            ],
            subscriptionDeliveryId: (string) $delivery->getKey(),
            auditMetadata: ['order_id' => (string) $order->getKey()],
        );

        return ['generated' => 1, 'skipped' => 0, 'completed' => 0];
    }

    /**
     * The dishes that make up one day, after the allergen gate.
     *
     * **Where the dishes come from.** The customer's own choices for the date,
     * made at purchase or changed before the cut-off. A date nobody chose for —
     * a balance day a skip, a pause or a closed day pushed later — is filled by
     * `repeatChosenDay()` from the customer's own earlier choices before this
     * method reads anything, and from there the rows are indistinguishable: the
     * same allergen check, the same substitution rules, the same ledger. The
     * safety gate must not have two doors.
     *
     * **A day with no choices at all still generates** — a subscription bought
     * before customers chose, with nothing to repeat — and the order carries
     * the plan-day line alone. Never invent a dish.
     *
     * @return array{0: list<CatalogueItem>, 1: list<array<string, mixed>>} the safe dishes, and the slots that could not be filled
     */
    private function safeMealsFor(
        Subscription $subscription,
        CustomerAccount $account,
        CarbonImmutable $date,
        CarbonImmutable $now,
    ): array {
        $this->repeatChosenDay($subscription, $date);

        $choices = SubscriptionMealChoice::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $date->toDateString())
            ->orderBy('slot')
            ->orderBy('sequence')
            ->get();

        $meals = [];
        $unfillable = [];

        foreach ($choices as $choice) {
            $verdict = $this->safety->check($account, $choice->catalogue_item_id);

            $choice->safety_checked_at = $now;

            if ($verdict['safe']) {
                $choice->unsafe_allergen_classes = null;
                $choice->save();

                $meal = CatalogueItem::withoutTenancy()->whereKey($choice->catalogue_item_id)->first();

                if ($meal instanceof CatalogueItem) {
                    $meals[] = $meal;
                }

                continue;
            }

            $replaced = CatalogueItem::withoutTenancy()->whereKey($choice->catalogue_item_id)->first();

            if (! $replaced instanceof CatalogueItem) {
                $unfillable[] = ['slot' => $choice->slot, 'reason' => 'item_unknown'];

                continue;
            }

            [$substitute, $why] = $this->substitutions->forSubscription($subscription, $replaced, $date);

            if (! $substitute instanceof CatalogueItem) {
                $choice->unsafe_allergen_classes = $verdict['allergen_classes'];
                $choice->save();

                $unfillable[] = [
                    'slot' => $choice->slot,
                    'reason' => $why ?? 'no_safe_candidate',
                    'allergen_classes' => $verdict['allergen_classes'],
                ];

                continue;
            }

            $choice->replaced_catalogue_item_id = $choice->catalogue_item_id;
            $choice->catalogue_item_id = (string) $substitute->getKey();
            $choice->catalogue_item_variant_id = null;
            $choice->source = MealChoiceSource::Substituted;
            $choice->unsafe_allergen_classes = $verdict['allergen_classes'];
            $choice->save();

            $meals[] = $substitute;

            $this->journal->record(
                $subscription,
                'meal_substituted',
                deliveryDate: $date,
                detail: [
                    'slot' => $choice->slot,
                    'replaced' => $replaced->name_en,
                    'sent' => $substitute->name_en,
                    'allergen_classes' => $verdict['allergen_classes'],
                ],
                auditMetadata: ['allergen_classes' => $verdict['allergen_classes']],
            );
        }

        return [$meals, $unfillable];
    }

    /**
     * Fill a date nobody chose for with the customer's own latest choices for
     * the same weekday — or, failing that, their latest chosen day.
     *
     * Every delivery day is chosen at purchase, but the balance moves: a skip,
     * a pause or a day the kitchen was shut carries a day onto a date past the
     * last one chosen, and a weekday change lands days on dates nobody picked
     * for. The honest default for such a day is what this customer already
     * chose, not something the kitchen picks for them. A substituted row
     * repeats what the person chose (`replaced_catalogue_item_id`), and the
     * allergen gate runs over the repeat like any other row.
     *
     * **Race-free like the claim.** The rows go in through one
     * `insertOrIgnore` against `(subscription_id, delivery_date, slot,
     * sequence)`, so a choice the customer made, or a repeat a previous tick
     * wrote, keeps the row it has.
     */
    private function repeatChosenDay(Subscription $subscription, CarbonImmutable $date): void
    {
        $chosen = SubscriptionMealChoice::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $date->toDateString())
            ->exists();

        if ($chosen) {
            return;
        }

        $earlier = SubscriptionMealChoice::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', '<', $date->toDateString())
            ->orderByDesc('delivery_date')
            ->limit(400)
            ->get()
            ->groupBy(static fn (SubscriptionMealChoice $choice): string => $choice->delivery_date->toDateString());

        if ($earlier->isEmpty()) {
            return;
        }

        $source = $earlier->first(static fn ($rows, string $day): bool => CarbonImmutable::parse($day)->dayOfWeekIso === $date->dayOfWeekIso)
            ?? $earlier->first();

        $now = CarbonImmutable::now();
        $rows = [];

        foreach ($source as $choice) {
            $rows[] = [
                'id' => $this->identifiers->generate(),
                'subscription_id' => (string) $subscription->getKey(),
                'organisation_id' => $subscription->organisation_id,
                'subscription_delivery_id' => null,
                'delivery_date' => $date->toDateString(),
                'slot' => $choice->slot,
                'sequence' => $choice->sequence,
                'catalogue_item_id' => $choice->replaced_catalogue_item_id ?? $choice->catalogue_item_id,
                'catalogue_item_variant_id' => null,
                'source' => MealChoiceSource::Repeated->value,
                // No actor: an hourly job is not a person.
                'created_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        SubscriptionMealChoice::query()->insertOrIgnore($rows);
    }

    /**
     * Settle a day as skipped, consuming nothing.
     *
     * @param  array<string, mixed>  $detail
     */
    private function skipDay(
        Subscription $subscription,
        SubscriptionDelivery $delivery,
        CarbonImmutable $date,
        SubscriptionDeliveryStatus $status,
        string $skipReason,
        array $detail,
    ): void {
        $delivery->status = $status;
        $delivery->consumed = false;
        $delivery->skip_reason = $skipReason;
        $delivery->settled_at = CarbonImmutable::now();
        $delivery->save();

        $this->journal->record(
            $subscription,
            $status === SubscriptionDeliveryStatus::SkippedNoSafeMeal ? 'no_safe_meal' : 'day_skipped',
            deliveryDate: $date,
            detail: $detail + ['reason' => $skipReason, 'balance_consumed' => false],
            subscriptionDeliveryId: (string) $delivery->getKey(),
        );
    }

    /**
     * Give back the days whose orders the kitchen cancelled.
     */
    public function reconcile(): int
    {
        // Narrowed to the rows that can possibly have changed — a consumed day
        // whose order has since been cancelled. Reading every consumed delivery
        // and checking each order in PHP would make an hourly job's cost grow
        // with the platform's whole history rather than with the number of
        // cancellations.
        $suspect = SubscriptionDelivery::query()
            ->where('consumed', true)
            ->whereNotNull('order_id')
            ->whereIn('order_id', Order::query()
                ->where('status', OrderStatus::Cancelled->value)
                ->select('id'))
            ->get();

        $restored = 0;

        foreach ($suspect as $delivery) {
            $subscription = $delivery->subscription;

            if (! $subscription instanceof Subscription) {
                continue;
            }

            DB::transaction(function () use ($delivery, $subscription): void {
                $delivery->status = SubscriptionDeliveryStatus::Cancelled;
                $delivery->consumed = false;
                $delivery->save();

                $subscription->balance_days_consumed = max(0, $subscription->balance_days_consumed - 1);
                $subscription->save();
            });

            $this->journal->record(
                $subscription,
                'day_restored',
                deliveryDate: $delivery->delivery_date,
                detail: ['reason' => 'order_cancelled', 'order_id' => $delivery->order_id],
                subscriptionDeliveryId: (string) $delivery->getKey(),
            );

            $restored++;
        }

        return $restored;
    }

    /**
     * Move the cursor past the day just dealt with.
     *
     * `DeliveryCursor` owns the walk — the next weekday the subscription
     * delivers on that nobody has already skipped — because a customer's skip
     * moves the same cursor from `SubscriptionService` and the two must agree
     * on where it lands.
     */
    private function advanceCursor(Subscription $subscription, CarbonImmutable $from): void
    {
        $this->cursor->advance($subscription, $from);
    }

    /**
     * The replay key for one subscription day.
     *
     * Derived rather than random, so a tick that crashed after placing the
     * order and before writing the delivery row replays into the same order
     * instead of placing a second one.
     */
    public function idempotencyKeyFor(Subscription $subscription, CarbonImmutable $date): string
    {
        return 'subscription:'.$subscription->getKey().':'.$date->toDateString();
    }
}
