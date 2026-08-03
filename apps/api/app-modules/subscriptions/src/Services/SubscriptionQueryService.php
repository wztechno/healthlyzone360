<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Contracts\SubscriptionQuery;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Illuminate\Database\Eloquent\Builder;

/**
 * The port's implementation — three counts, and nothing that leaks a plan.
 *
 * Deliberately narrow. J2's closure needs to know *whether* a customer has a
 * standing arrangement, not what they eat, what it costs or which kitchen it is
 * with; returning a model would hand a closure workflow the whole subscription
 * and make the next question "can we just read one more field from it".
 */
final readonly class SubscriptionQueryService implements SubscriptionQuery
{
    public function hasActiveSubscriptions(string $customerAccountId): bool
    {
        return $this->liveScope($customerAccountId)->exists();
    }

    public function activeSubscriptionCount(string $customerAccountId): int
    {
        return $this->liveScope($customerAccountId)->count();
    }

    public function hasUpcomingDeliveries(string $customerAccountId): bool
    {
        $today = CarbonImmutable::now()->startOfDay()->toDateString();

        return SubscriptionDelivery::query()
            ->whereIn('subscription_id', Subscription::query()
                ->where('customer_account_id', $customerAccountId)
                ->select('id'))
            ->whereIn('status', [
                SubscriptionDeliveryStatus::Scheduled->value,
                SubscriptionDeliveryStatus::Generated->value,
            ])
            ->whereDate('delivery_date', '>=', $today)
            ->exists();
    }

    /**
     * @return Builder<Subscription>
     */
    private function liveScope(string $customerAccountId): Builder
    {
        return Subscription::query()
            ->where('customer_account_id', $customerAccountId)
            ->whereIn('status', [SubscriptionStatus::Active->value, SubscriptionStatus::Paused->value]);
    }
}
