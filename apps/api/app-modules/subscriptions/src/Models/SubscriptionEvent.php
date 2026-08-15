<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One entry in a subscription's own, customer-readable history.
 *
 * Append-only: nothing in this module updates or deletes a row, and the table
 * has no `updated_at` to update. `UPDATED_AT = null` states that to Eloquent so
 * a stray `save()` cannot look for a column that is not there.
 *
 * @property string $id
 * @property string $subscription_id
 * @property string $organisation_id
 * @property string|null $subscription_delivery_id
 * @property string $event_type
 * @property CarbonImmutable|null $delivery_date
 * @property array<string, mixed> $detail
 * @property string|null $actor_user_id
 * @property CarbonImmutable $occurred_at
 * @property CarbonImmutable|null $created_at
 * @property-read Subscription|null $subscription
 */
class SubscriptionEvent extends BaseModel
{
    public const ?string UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'detail' => 'array',
            'delivery_date' => 'date',
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Subscription, $this>
     */
    public function subscription(): BelongsTo
    {
        return $this->belongsTo(Subscription::class);
    }
}
