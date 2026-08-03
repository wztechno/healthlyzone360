<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Models;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Models\Order;
use Healthy360\Subscriptions\Enums\SubscriptionDeliveryStatus;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One delivery day of one subscription — the row a balance day is spent on.
 *
 * `consumed` is stored rather than derived from `status`, and reading it is the
 * only correct way to ask whether a day was spent. See the migration for why.
 *
 * @property string $id
 * @property string $subscription_id
 * @property string $organisation_id
 * @property string|null $branch_id
 * @property CarbonImmutable $delivery_date
 * @property string|null $delivery_window_code
 * @property SubscriptionDeliveryStatus $status
 * @property bool $consumed
 * @property string|null $skip_reason
 * @property string|null $order_id
 * @property CarbonImmutable|null $generated_at
 * @property CarbonImmutable|null $settled_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Subscription|null $subscription
 * @property-read Order|null $order
 * @property-read Collection<int, SubscriptionMealChoice> $choices
 */
class SubscriptionDelivery extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => SubscriptionDeliveryStatus::class,
            'consumed' => 'boolean',
            'delivery_date' => 'date',
            'generated_at' => 'datetime',
            'settled_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Subscription, $this>
     */
    public function subscription(): BelongsTo
    {
        return $this->belongsTo(Subscription::class);
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * @return HasMany<SubscriptionMealChoice, $this>
     */
    public function choices(): HasMany
    {
        return $this->hasMany(SubscriptionMealChoice::class);
    }
}
