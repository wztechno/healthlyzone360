<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\Subscription;

/**
 * What happens when the balance runs out.
 *
 * **A subscription that has spent its last day is `completed`, not renewed.**
 * Nothing here starts a second subscription, charges anybody, or extends a
 * balance. §5 is explicit that a renewal quotes *current* prices, which means a
 * renewal is a new purchase decision made by the customer — and a service that
 * quietly rolled a plan over at the grandfathered price would be the exact
 * failure the grandfathering rule was written to bound. The renewal offer is an
 * event on the subscription's own history; acting on it is `SubscriptionService::create()`,
 * called by a customer who said yes.
 *
 * **The quote is deliberately fetched fresh.** `SubscriptionPricing` is asked
 * again, on today's tariff, through today's channel — the same call
 * `create()` makes. It may come back with nothing, because a kitchen may have
 * withdrawn the plan, retired the duration or stopped pricing it; that is a
 * real answer and the offer says so rather than falling back to what the
 * customer used to pay.
 */
final readonly class RenewalService
{
    public function __construct(
        private SubscriptionPricing $pricing,
        private SubscriptionJournal $journal,
    ) {}

    /**
     * Close an exhausted subscription and record the renewal offer beside it.
     */
    public function complete(Subscription $subscription): Subscription
    {
        if ($subscription->status !== SubscriptionStatus::Active || ! $subscription->isExhausted()) {
            return $subscription;
        }

        $now = CarbonImmutable::now();

        $subscription->status = SubscriptionStatus::Completed;
        $subscription->completed_at = $now;
        $subscription->next_generation_date = null;
        $subscription->lock_version = $subscription->lock_version + 1;
        $subscription->save();

        $this->journal->record($subscription, 'completed', detail: [
            'balance_days_total' => $subscription->balance_days_total,
        ]);

        [$quote] = $this->quote($subscription, $now);

        $this->journal->record($subscription, 'renewal_offered', detail: $quote instanceof PlanQuote
            ? $quote->toArray() + ['available' => true]
            // Not "free" and not "unchanged" — unavailable. A renewal prompt
            // that showed the old price would be quoting a tariff nobody is
            // standing behind any more.
            : ['available' => false]);

        return $subscription;
    }

    /**
     * Today's price for the same plan, configuration and run.
     *
     * @return array{0: PlanQuote|null, 1: list<array<string, mixed>>}
     */
    public function quote(Subscription $subscription, ?CarbonImmutable $on = null): array
    {
        return $this->pricing->quote(
            $subscription->sales_channel_id,
            $subscription->catalogue_item_id,
            $subscription->catalogue_item_variant_id,
            $subscription->plan_duration_id,
            $on ?? CarbonImmutable::now(),
        );
    }
}
