<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Services\LineProbe;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\PlanType;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Services\ZoneResolver;
use Healthy360\Orders\Services\CheckoutEligibility;
use Healthy360\Orders\Services\SellerContext;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Exceptions\SubscriptionChangeRefused;
use Healthy360\Subscriptions\Exceptions\SubscriptionRefused;
use Healthy360\Subscriptions\Models\CreditMemo;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Starting a subscription, and everything a customer may do to one afterwards.
 *
 * ## Starting one
 *
 * A subscription is a checkout with a longer memory, and `create()` runs the
 * same gates a checkout runs — deliberately the *same code*, not the same
 * shape. `CheckoutEligibility` decides whether the party may buy food at all,
 * `ZoneResolver` and `AreaServiceLookup` decide whether the kitchen goes there,
 * and `LineProbe` decides whether the plan is orderable through the channel on
 * the day. Restating any of them here would be a second definition that
 * eventually disagrees with C1's, and the surface where it disagreed would be
 * the one that took the customer's money for twenty days.
 *
 * Two gates are this module's own. **A guest may not subscribe**: a guest
 * account expires by construction (G1), and selling somebody twenty days of
 * food against an identity the platform will delete in fourteen is a promise it
 * cannot keep. And **the price is captured**, once, at purchase — the
 * grandfathering §5 promises is implemented as a column and not as a policy,
 * because a policy is a thing a later query forgets.
 *
 * ## Changing one
 *
 * Every change goes through the same two questions. Is the transition legal —
 * `SubscriptionStatus` owns that, so no caller can invent a fifth edge. And is
 * it still in time — `ChangeWindow` owns that, reading the kitchen's own
 * `change_cutoff_hours`. §2's rule is one sentence and it applies to all of
 * skip, pause, resume, address and window, so it is asked in one place and
 * answered the same way for each.
 *
 * **Nothing here consumes a balance day, ever.** Pausing, skipping and
 * cancelling all leave `balance_days_consumed` exactly where it was; only
 * generation moves it, and only when a real order exists. That is §1 stated as
 * a property of the code rather than as a paragraph: the balance stretches into
 * the future, it does not evaporate.
 *
 * ## Cancelling one
 *
 * `cancelled` is terminal and the refund is a `credit_memo` for manual
 * settlement — unused days × the effective per-day price actually paid, after
 * the duration discount, so the discount already enjoyed on delivered days is
 * not clawed back (§3). No money moves. The memo's unique index makes a second
 * one impossible, which matters because a double refund is much harder to
 * notice than a missing one.
 */
final readonly class SubscriptionService
{
    public function __construct(
        private CheckoutEligibility $eligibility,
        private AreaServiceLookup $areas,
        private ZoneResolver $zones,
        private LineProbe $probe,
        private SubscriptionPricing $pricing,
        private ChangeWindow $window,
        private SubscriptionJournal $journal,
        private SellerContext $seller,
        private TenantContext $context,
    ) {}

    /**
     * Start a subscription, capturing its price.
     *
     * @throws SubscriptionRefused|ApiException
     */
    public function create(NewSubscription $request): Subscription
    {
        $channel = SalesChannel::withoutTenancy()->whereKey($request->salesChannelId)->first();

        if (! $channel instanceof SalesChannel) {
            throw new SubscriptionRefused([['reason' => 'channel_unknown', 'sales_channel_id' => $request->salesChannelId]]);
        }

        // The whole creation runs as the seller, for the reason `SellerContext`
        // records: a customer is a member of no organisation, and the delivery
        // map is an organisation-scoped table that fails closed.
        return $this->seller->during(
            $channel->organisation_id,
            $request->branchId,
            fn (): Subscription => $this->createNow($request, $channel),
        );
    }

    /**
     * @throws SubscriptionRefused
     */
    private function createNow(NewSubscription $request, SalesChannel $channel): Subscription
    {
        $now = CarbonImmutable::now();
        $reasons = [];

        $reasons = [...$reasons, ...$this->eligibility->outstanding($request->account)];

        if ($request->account->account_type === CustomerAccountType::Guest) {
            $reasons[] = ['reason' => 'guest_may_not_subscribe'];
        }

        $reasons = [...$reasons, ...$this->weekdayReasons($request->weekdays)];
        $reasons = [...$reasons, ...$this->addressReasons($request->account->getKey(), $request->address)];

        [$plan, $planReasons] = $this->planFor($request->catalogueItemId, $channel->organisation_id);
        $reasons = [...$reasons, ...$planReasons];

        $reasons = [...$reasons, ...$this->configurationReasons($request->catalogueItemVariantId, $request->catalogueItemId)];

        [$quote, $quoteReasons] = $this->pricing->quote(
            (string) $channel->getKey(),
            $request->catalogueItemId,
            $request->catalogueItemVariantId,
            $request->planDurationId,
            $now,
        );
        $reasons = [...$reasons, ...$quoteReasons];

        if ($quote instanceof PlanQuote) {
            // Orderability, asked of the same probe a checkout asks. The price
            // half of its answer is discarded — the quote above is
            // authoritative and is what gets captured — but "is this plan
            // published and offered on this channel" has one definition and
            // this is it.
            $probe = $this->probe->probe(
                $channel,
                $request->catalogueItemId,
                $request->catalogueItemVariantId,
                '1',
                $now,
                $quote->currencyCode,
            );

            foreach ($probe->refusals as $refusal) {
                $reasons[] = $refusal;
            }
        }

        [$zone, $zoneReasons] = $this->zoneFor($request->branchId, $request->address);
        $reasons = [...$reasons, ...$zoneReasons];

        if ($quote instanceof PlanQuote && $zone instanceof DeliveryZone && $zone->delivery_fee_minor !== null && $zone->currency_code !== $quote->currencyCode) {
            $reasons[] = [
                'reason' => 'currency_mismatch',
                'subject' => 'delivery_fee',
                'expected_currency' => $quote->currencyCode,
                'offered_currency' => $zone->currency_code,
            ];
        }

        if ($reasons !== [] || ! $quote instanceof PlanQuote || ! $plan instanceof CatalogueItem) {
            throw new SubscriptionRefused($reasons);
        }

        $subscription = DB::transaction(function () use ($request, $channel, $quote, $now): Subscription {
            $subscription = new Subscription;
            $subscription->organisation_id = $channel->organisation_id;
            $subscription->customer_account_id = (string) $request->account->getKey();
            $subscription->sales_channel_id = (string) $channel->getKey();
            $subscription->branch_id = $request->branchId;
            $subscription->catalogue_item_id = $request->catalogueItemId;
            $subscription->catalogue_item_variant_id = $request->catalogueItemVariantId;
            $subscription->plan_duration_id = $request->planDurationId;

            $subscription->currency_code = $quote->currencyCode;
            $subscription->captured_unit_price_minor = $quote->listPriceMinor;
            $subscription->captured_discount_percent = $quote->discountPercent;
            $subscription->effective_day_price_minor = $quote->perDayMinor;
            $subscription->captured_price_list_id = $quote->priceListId;
            $subscription->captured_price_list_item_id = $quote->priceListItemId;
            $subscription->captured_at = $now;

            $subscription->weekdays = $this->normalisedWeekdays($request->weekdays);
            $subscription->delivery_window_code = $request->deliveryWindowCode;
            $subscription->customer_address_id = (string) $request->address->getKey();

            $subscription->status = SubscriptionStatus::Active;
            $subscription->balance_days_total = $quote->days;
            $subscription->balance_days_consumed = 0;
            $subscription->no_substitutions = $request->noSubstitutions;
            $subscription->created_by = $this->context->userId();
            $subscription->lock_version = 0;
            $subscription->save();

            $subscription->next_generation_date = $this->window->firstChangeableDate(
                $subscription,
                $request->startFrom instanceof CarbonImmutable && $request->startFrom->greaterThan($now)
                    ? $request->startFrom
                    : $now,
            );
            $subscription->save();

            return $subscription;
        });

        $this->journal->record(
            $subscription,
            'created',
            detail: [
                'plan' => $plan->name_en,
                'days' => $quote->days,
                'per_day_minor' => $quote->perDayMinor,
                'currency' => $quote->currencyCode,
                'weekdays' => $subscription->weekdays,
            ],
            auditMetadata: [
                'catalogue_item_id' => $request->catalogueItemId,
                'catalogue_item_variant_id' => $request->catalogueItemVariantId,
                'balance_days_total' => $quote->days,
                'per_day_minor' => $quote->perDayMinor,
                'currency' => $quote->currencyCode,
            ],
        );

        return $subscription;
    }

    /**
     * Stop generating deliveries, keeping the balance.
     *
     * @throws SubscriptionChangeRefused
     */
    public function pause(Subscription $subscription, ?int $expectedLockVersion = null): Subscription
    {
        $now = CarbonImmutable::now();
        $reasons = $this->versionReasons($subscription, $expectedLockVersion);
        $reasons = [...$reasons, ...$this->transitionReasons($subscription, SubscriptionStatus::Paused)];
        $reasons = [...$reasons, ...$this->rightReasons($subscription, 'pause')];
        $reasons = [...$reasons, ...$this->nextDayWindowReasons($subscription, $now)];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $subscription->status = SubscriptionStatus::Paused;
        $subscription->paused_at = $now;
        $subscription->pause_count = $subscription->pause_count + 1;
        // A paused subscription has no next date. Nulling the cursor is what
        // takes it out of the hourly sweep, rather than a status predicate the
        // sweep has to remember to apply.
        $subscription->next_generation_date = null;
        $subscription->lock_version = $subscription->lock_version + 1;
        $subscription->updated_by = $this->context->userId();
        $subscription->save();

        $this->journal->record($subscription, 'paused', detail: ['remaining_days' => $subscription->remainingDays()]);

        return $subscription;
    }

    /**
     * @throws SubscriptionChangeRefused
     */
    public function resume(Subscription $subscription, ?int $expectedLockVersion = null): Subscription
    {
        $now = CarbonImmutable::now();
        $reasons = $this->versionReasons($subscription, $expectedLockVersion);
        $reasons = [...$reasons, ...$this->transitionReasons($subscription, SubscriptionStatus::Active)];

        if ($subscription->isExhausted()) {
            $reasons[] = ['reason' => 'exhausted', 'balance_days_total' => $subscription->balance_days_total];
        }

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $subscription->status = SubscriptionStatus::Active;
        $subscription->resumed_at = $now;
        // The cursor restarts at the first day a change can still reach, which
        // is the same rule a new subscription starts on: resuming must not
        // produce a delivery the customer had no chance to stop.
        $subscription->next_generation_date = $this->window->firstChangeableDate($subscription, $now);
        $subscription->lock_version = $subscription->lock_version + 1;
        $subscription->updated_by = $this->context->userId();
        $subscription->save();

        $this->journal->record($subscription, 'resumed', detail: [
            'remaining_days' => $subscription->remainingDays(),
            'next_delivery' => $subscription->next_generation_date->toDateString(),
        ]);

        return $subscription;
    }

    /**
     * Skip one delivery day. Costs nothing.
     *
     * The row is written as `skipped_customer` with `consumed = false`, which is
     * the §1 promise in its most literal form — and it is written *before* the
     * day is ever generated, so the unique index on `(subscription_id,
     * delivery_date)` is what stops generation producing an order for a day the
     * customer already skipped.
     *
     * @throws SubscriptionChangeRefused
     */
    public function skip(Subscription $subscription, CarbonImmutable $date, ?int $expectedLockVersion = null): SubscriptionDelivery
    {
        $now = CarbonImmutable::now();
        $day = $date->startOfDay();

        $reasons = $this->versionReasons($subscription, $expectedLockVersion);
        $reasons = [...$reasons, ...$this->rightReasons($subscription, 'skip')];

        if (! $subscription->status->isLive()) {
            $reasons[] = ['reason' => 'invalid_transition', 'status' => $subscription->status->value];
        }

        if (! $subscription->deliversOnWeekday($day->dayOfWeekIso)) {
            $reasons[] = ['reason' => 'not_a_delivery_day', 'delivery_date' => $day->toDateString(), 'weekdays' => $subscription->weekdays];
        }

        $reasons = [...$reasons, ...$this->window->reasonsFor($subscription, $day, $now)];

        $existing = SubscriptionDelivery::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereDate('delivery_date', $day->toDateString())
            ->first();

        if ($existing instanceof SubscriptionDelivery && $existing->status->isSettled()) {
            $reasons[] = ['reason' => 'already_settled', 'delivery_date' => $day->toDateString(), 'status' => $existing->status->value];
        }

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $delivery = DB::transaction(function () use ($subscription, $existing, $day): SubscriptionDelivery {
            $delivery = $existing instanceof SubscriptionDelivery ? $existing : new SubscriptionDelivery;
            $delivery->subscription_id = (string) $subscription->getKey();
            $delivery->organisation_id = $subscription->organisation_id;
            $delivery->branch_id = $subscription->branch_id;
            $delivery->delivery_date = $day;
            $delivery->delivery_window_code = $subscription->delivery_window_code;
            $delivery->status = SubscriptionDeliveryStatus::SkippedCustomer;
            $delivery->consumed = false;
            $delivery->skip_reason = 'customer_request';
            $delivery->settled_at = CarbonImmutable::now();
            $delivery->save();

            return $delivery;
        });

        $this->journal->record(
            $subscription,
            'day_skipped',
            deliveryDate: $day,
            detail: ['reason' => 'customer_request'],
            subscriptionDeliveryId: (string) $delivery->getKey(),
        );

        return $delivery;
    }

    /**
     * Stop the subscription for good and record what is owed.
     *
     * @return array{subscription: Subscription, credit_memo: CreditMemo|null}
     *
     * @throws SubscriptionChangeRefused
     */
    public function cancel(Subscription $subscription, string $reason = 'customer_request', ?int $expectedLockVersion = null): array
    {
        $now = CarbonImmutable::now();
        $reasons = $this->versionReasons($subscription, $expectedLockVersion);
        $reasons = [...$reasons, ...$this->transitionReasons($subscription, SubscriptionStatus::Cancelled)];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $unused = $subscription->remainingDays();

        $result = DB::transaction(function () use ($subscription, $reason, $now, $unused): array {
            $subscription->status = SubscriptionStatus::Cancelled;
            $subscription->cancelled_at = $now;
            $subscription->cancellation_reason = $reason;
            $subscription->cancelled_by = $this->context->userId();
            $subscription->next_generation_date = null;
            $subscription->lock_version = $subscription->lock_version + 1;
            $subscription->updated_by = $this->context->userId();
            $subscription->save();

            if ($unused < 1) {
                // Nothing is owed, so nothing is recorded. A zero memo would be
                // an obligation somebody eventually tries to settle.
                return ['subscription' => $subscription, 'credit_memo' => null];
            }

            $memo = new CreditMemo;
            $memo->organisation_id = $subscription->organisation_id;
            $memo->customer_account_id = $subscription->customer_account_id;
            $memo->subscription_id = (string) $subscription->getKey();
            $memo->reason = 'subscription_cancelled';
            $memo->unused_days = $unused;
            $memo->per_day_minor = $subscription->effective_day_price_minor;
            $memo->amount_minor = $unused * $subscription->effective_day_price_minor;
            $memo->currency_code = $subscription->currency_code;
            $memo->recorded_at = $now;
            $memo->save();

            return ['subscription' => $subscription, 'credit_memo' => $memo];
        });

        $memo = $result['credit_memo'];
        $refundMinor = $memo === null ? 0 : $memo->amount_minor;

        $this->journal->record(
            $subscription,
            'cancelled',
            detail: [
                'cancellation_reason' => $reason,
                'unused_days' => $unused,
                'refund_minor' => $refundMinor,
                'currency' => $subscription->currency_code,
                // The one sentence the customer most needs: no money has moved.
                'settlement' => 'manual',
            ],
            auditMetadata: [
                'cancellation_reason' => $reason,
                'unused_days' => $unused,
                'refund_minor' => $refundMinor,
                'credit_memo_id' => $memo === null ? null : (string) $memo->getKey(),
            ],
        );

        return $result;
    }

    /**
     * @throws SubscriptionChangeRefused
     */
    public function changeAddress(Subscription $subscription, CustomerAddress $address, ?int $expectedLockVersion = null): Subscription
    {
        $now = CarbonImmutable::now();
        $reasons = $this->versionReasons($subscription, $expectedLockVersion);

        if (! $subscription->status->isLive()) {
            $reasons[] = ['reason' => 'invalid_transition', 'status' => $subscription->status->value];
        }

        $reasons = [...$reasons, ...$this->addressReasons($subscription->customer_account_id, $address)];
        $reasons = [...$reasons, ...$this->nextDayWindowReasons($subscription, $now)];

        [, $zoneReasons] = $this->seller->during(
            $subscription->organisation_id,
            $subscription->branch_id,
            fn (): array => $this->zoneFor($subscription->branch_id, $address),
        );
        $reasons = [...$reasons, ...$zoneReasons];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $subscription->customer_address_id = (string) $address->getKey();
        $subscription->lock_version = $subscription->lock_version + 1;
        $subscription->updated_by = $this->context->userId();
        $subscription->save();

        // The address identifier and nothing about the address itself. Every
        // free-text part of it is `Confidential`, and a history a support agent
        // reads is not the place to reproduce somebody's front door.
        $this->journal->record($subscription, 'address_changed', detail: ['customer_address_id' => (string) $address->getKey()]);

        return $subscription;
    }

    /**
     * @throws SubscriptionChangeRefused
     */
    public function changeWindow(Subscription $subscription, ?string $deliveryWindowCode, ?int $expectedLockVersion = null): Subscription
    {
        $now = CarbonImmutable::now();
        $reasons = $this->versionReasons($subscription, $expectedLockVersion);

        if (! $subscription->status->isLive()) {
            $reasons[] = ['reason' => 'invalid_transition', 'status' => $subscription->status->value];
        }

        $reasons = [...$reasons, ...$this->nextDayWindowReasons($subscription, $now)];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $subscription->delivery_window_code = $deliveryWindowCode;
        $subscription->lock_version = $subscription->lock_version + 1;
        $subscription->updated_by = $this->context->userId();
        $subscription->save();

        $this->journal->record($subscription, 'window_changed', detail: ['delivery_window' => $deliveryWindowCode]);

        return $subscription;
    }

    /**
     * Change which weekdays the subscription delivers on.
     *
     * The weekly selection §7 ships. The cursor is recomputed afterwards,
     * because the old one may name a day the subscription no longer delivers
     * on — and a cursor pointing at a day that will never come is a
     * subscription that silently stops.
     *
     * @param  list<int>  $weekdays
     *
     * @throws SubscriptionChangeRefused
     */
    public function changeWeekdays(Subscription $subscription, array $weekdays, ?int $expectedLockVersion = null): Subscription
    {
        $now = CarbonImmutable::now();
        $reasons = $this->versionReasons($subscription, $expectedLockVersion);

        if (! $subscription->status->isLive()) {
            $reasons[] = ['reason' => 'invalid_transition', 'status' => $subscription->status->value];
        }

        $reasons = [...$reasons, ...$this->weekdayReasons($weekdays)];
        $reasons = [...$reasons, ...$this->nextDayWindowReasons($subscription, $now)];

        if ($reasons !== []) {
            throw new SubscriptionChangeRefused($reasons);
        }

        $subscription->weekdays = $this->normalisedWeekdays($weekdays);
        $subscription->lock_version = $subscription->lock_version + 1;
        $subscription->updated_by = $this->context->userId();

        if ($subscription->status === SubscriptionStatus::Active) {
            $subscription->next_generation_date = $this->window->firstChangeableDate($subscription, $now);
        }

        $subscription->save();

        $this->journal->record($subscription, 'weekdays_changed', detail: [
            'weekdays' => $subscription->weekdays,
            'next_delivery' => $subscription->next_generation_date?->toDateString(),
        ]);

        return $subscription;
    }

    /**
     * The balance view: what is left, what was used, and what is coming.
     *
     * @return array{
     *     status: string,
     *     balance_days_total: int,
     *     balance_days_consumed: int,
     *     remaining_days: int,
     *     per_day_minor: int,
     *     currency_code: string,
     *     weekdays: list<int>,
     *     next_delivery_date: string|null,
     *     skipped_days: int,
     * }
     */
    public function balance(Subscription $subscription): array
    {
        $skipped = SubscriptionDelivery::query()
            ->where('subscription_id', $subscription->getKey())
            ->whereIn('status', [
                SubscriptionDeliveryStatus::SkippedCustomer->value,
                SubscriptionDeliveryStatus::SkippedNoSafeMeal->value,
                SubscriptionDeliveryStatus::SkippedUnavailable->value,
            ])
            ->count();

        return [
            'status' => $subscription->status->value,
            'balance_days_total' => $subscription->balance_days_total,
            'balance_days_consumed' => $subscription->balance_days_consumed,
            'remaining_days' => $subscription->remainingDays(),
            'per_day_minor' => $subscription->effective_day_price_minor,
            'currency_code' => $subscription->currency_code,
            'weekdays' => $this->normalisedWeekdays($subscription->weekdays),
            'next_delivery_date' => $subscription->next_generation_date?->toDateString(),
            'skipped_days' => $skipped,
        ];
    }

    /**
     * Whether the plan permits this right at all.
     *
     * `skip_allowed` and `pause_allowed` are the kitchen's stored decisions, and
     * the profile migration is explicit that S1 is what reads them. A plan that
     * forbids pausing forbids it, and the platform does not soften that into a
     * preference.
     *
     * @return list<array<string, mixed>>
     */
    private function rightReasons(Subscription $subscription, string $right): array
    {
        $profile = $this->window->profileFor($subscription);

        if (! $profile instanceof SubscriptionPlanProfile) {
            return [];
        }

        $permitted = match ($right) {
            'skip' => $profile->skip_allowed,
            'pause' => $profile->pause_allowed,
            default => true,
        };

        return $permitted ? [] : [['reason' => 'not_permitted', 'right' => $right]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function transitionReasons(Subscription $subscription, SubscriptionStatus $next): array
    {
        if ($subscription->status->canTransitionTo($next)) {
            return [];
        }

        return [[
            'reason' => 'invalid_transition',
            'status' => $subscription->status->value,
            'attempted' => $next->value,
        ]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function versionReasons(Subscription $subscription, ?int $expectedLockVersion): array
    {
        if ($expectedLockVersion === null || $expectedLockVersion === $subscription->lock_version) {
            return [];
        }

        return [['reason' => 'stale_version', 'expected' => $expectedLockVersion, 'current' => $subscription->lock_version]];
    }

    /**
     * The cut-off, asked of the next delivery the change would affect.
     *
     * A pause, an address change and a window change all take effect from the
     * next generated day, so the question is always "is *that* day still
     * changeable" — never "is some day". A paused subscription has no next day
     * and nothing to be late for.
     *
     * @return list<array<string, mixed>>
     */
    private function nextDayWindowReasons(Subscription $subscription, CarbonImmutable $now): array
    {
        $next = $subscription->next_generation_date;

        if ($next === null || $subscription->status !== SubscriptionStatus::Active) {
            return [];
        }

        return $this->window->reasonsFor($subscription, $next, $now);
    }

    /**
     * @return array{0: CatalogueItem|null, 1: list<array<string, mixed>>}
     */
    private function planFor(string $catalogueItemId, string $organisationId): array
    {
        $item = CatalogueItem::withoutTenancy()
            ->whereKey($catalogueItemId)
            ->where('organisation_id', $organisationId)
            ->first();

        if (! $item instanceof CatalogueItem) {
            return [null, [['reason' => 'plan_unknown', 'catalogue_item_id' => $catalogueItemId]]];
        }

        $reasons = [];

        if ($item->item_type !== CatalogueItemType::SubscriptionPlan) {
            $reasons[] = ['reason' => 'plan_not_subscription', 'item_type' => $item->item_type->value];
        }

        if (! $item->status->isConsumerVisible()) {
            $reasons[] = ['reason' => 'plan_not_published', 'status' => $item->status->value];
        }

        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->first();

        if (! $profile instanceof SubscriptionPlanProfile) {
            $reasons[] = ['reason' => 'plan_not_subscription', 'catalogue_item_id' => $catalogueItemId];
        } elseif ($profile->plan_type === PlanType::LimitedTime) {
            // The source workbook's own vocabulary: a limited-time offer is
            // sold once, not subscribed to.
            $reasons[] = ['reason' => 'plan_not_subscription', 'plan_type' => $profile->plan_type->value];
        }

        return [$reasons === [] ? $item : null, $reasons];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function configurationReasons(string $variantId, string $catalogueItemId): array
    {
        $variant = CatalogueItemVariant::withoutTenancy()
            ->whereKey($variantId)
            ->where('catalogue_item_id', $catalogueItemId)
            ->first();

        if (! $variant instanceof CatalogueItemVariant) {
            return [['reason' => 'configuration_unknown', 'catalogue_item_variant_id' => $variantId]];
        }

        $reasons = [];

        if ($variant->status !== VariantStatus::Active) {
            $reasons[] = ['reason' => 'configuration_not_active', 'status' => $variant->status->value];
        }

        if (! PlanVariantProfile::withoutTenancy()->whereKey($variantId)->exists()) {
            $reasons[] = ['reason' => 'configuration_unknown', 'catalogue_item_variant_id' => $variantId];
        }

        return $reasons;
    }

    /**
     * @param  list<int>  $weekdays
     * @return list<array<string, mixed>>
     */
    private function weekdayReasons(array $weekdays): array
    {
        if ($weekdays === []) {
            return [['reason' => 'weekdays_empty']];
        }

        foreach ($weekdays as $weekday) {
            if ($weekday < 1 || $weekday > 7) {
                return [['reason' => 'weekdays_invalid', 'weekdays' => $weekdays]];
            }
        }

        return [];
    }

    /**
     * @param  list<int>  $weekdays
     * @return list<int>
     */
    private function normalisedWeekdays(array $weekdays): array
    {
        $unique = [];

        foreach ($weekdays as $weekday) {
            $day = (int) $weekday;

            if (! in_array($day, $unique, true)) {
                $unique[] = $day;
            }
        }

        sort($unique);

        return $unique;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function addressReasons(mixed $customerAccountId, CustomerAddress $address): array
    {
        if ($address->customer_account_id !== (string) $customerAccountId) {
            // Deliberately the same answer as "no such address" — the C1 rule:
            // confirming an identifier belongs to somebody else is a disclosure.
            return [['reason' => 'address_not_owned']];
        }

        if ($address->address_type !== CustomerAddressType::Delivery) {
            return [['reason' => 'address_not_deliverable', 'address_type' => $address->address_type->value]];
        }

        return [];
    }

    /**
     * @return array{0: DeliveryZone|null, 1: list<array<string, mixed>>}
     */
    private function zoneFor(?string $branchId, CustomerAddress $address): array
    {
        $areaId = $address->delivery_area_id;
        $explained = $this->zones->explain($areaId, $branchId);

        if ($explained['serves'] && $explained['zone'] instanceof DeliveryZone) {
            return [$explained['zone'], []];
        }

        if ($explained['zone'] instanceof DeliveryZone) {
            return [null, [['reason' => 'zone_suspended', 'delivery_area_id' => $areaId, 'zone_status' => $explained['status']]]];
        }

        return [null, [[
            'reason' => 'area_not_served',
            'delivery_area_id' => $areaId,
            'served_by_anyone' => $this->areas->isServed($areaId),
        ]]];
    }
}
