<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Subscriptions\Database\Factories\SubscriptionFactory;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A standing arrangement to be fed.
 *
 * **Deliberately not `OrganisationScoped`**, the decision `CustomerAccount`,
 * `Cart` and `Order` all record: the person who holds this subscription is a
 * member of no organisation, and an ambient organisation scope would hide their
 * own plan from them or throw for want of a tenant. `organisation_id` still
 * means the seller, and every kitchen-facing read filters on it explicitly.
 *
 * The captured price columns are `Confidential` rather than `Public`: what one
 * customer negotiated or was grandfathered at is not what the plan costs today,
 * and a projection that treated them as public would publish a price list that
 * was never offered to anybody else.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $customer_account_id
 * @property string $sales_channel_id
 * @property string|null $branch_id
 * @property string $catalogue_item_id
 * @property string $catalogue_item_variant_id
 * @property string $plan_duration_id
 * @property string $currency_code
 * @property int $captured_unit_price_minor
 * @property string|null $captured_discount_percent
 * @property int $effective_day_price_minor
 * @property string|null $captured_price_list_id
 * @property string|null $captured_price_list_item_id
 * @property CarbonImmutable $captured_at
 * @property list<int> $weekdays
 * @property string|null $delivery_window_code
 * @property string $customer_address_id
 * @property SubscriptionStatus $status
 * @property int $balance_days_total
 * @property int $balance_days_consumed
 * @property CarbonImmutable|null $next_generation_date
 * @property bool $no_substitutions
 * @property CarbonImmutable|null $paused_at
 * @property CarbonImmutable|null $resumed_at
 * @property int $pause_count
 * @property CarbonImmutable|null $cancelled_at
 * @property string|null $cancellation_reason
 * @property string|null $cancelled_by
 * @property CarbonImmutable|null $completed_at
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CustomerAccount|null $customerAccount
 * @property-read CustomerAddress|null $address
 * @property-read CatalogueItem|null $plan
 * @property-read CatalogueItemVariant|null $configuration
 * @property-read Collection<int, SubscriptionDelivery> $deliveries
 * @property-read User|null $canceller
 */
#[Classified(DataClassification::Confidential, 'captured_unit_price_minor', 'effective_day_price_minor', 'captured_discount_percent')]
class Subscription extends BaseModel
{
    /** @use HasFactory<SubscriptionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => SubscriptionStatus::class,
            'weekdays' => 'array',
            'no_substitutions' => 'boolean',
            'balance_days_total' => 'integer',
            'balance_days_consumed' => 'integer',
            'captured_unit_price_minor' => 'integer',
            'effective_day_price_minor' => 'integer',
            'pause_count' => 'integer',
            'lock_version' => 'integer',
            'captured_at' => 'datetime',
            'next_generation_date' => 'date',
            'paused_at' => 'datetime',
            'resumed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    /**
     * How many delivery days are still owed.
     *
     * The number a cancellation refund multiplies, and the number that reaching
     * zero turns into `completed`.
     */
    public function remainingDays(): int
    {
        return max(0, $this->balance_days_total - $this->balance_days_consumed);
    }

    public function isExhausted(): bool
    {
        return $this->remainingDays() === 0;
    }

    /**
     * Whether the subscription delivers on this ISO weekday (1 = Monday).
     */
    public function deliversOnWeekday(int $isoWeekday): bool
    {
        return in_array($isoWeekday, array_map(intval(...), $this->weekdays), true);
    }

    /**
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class, 'customer_account_id');
    }

    /**
     * @return BelongsTo<CustomerAddress, $this>
     */
    public function address(): BelongsTo
    {
        return $this->belongsTo(CustomerAddress::class, 'customer_address_id');
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function configuration(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }

    /**
     * @return HasMany<SubscriptionDelivery, $this>
     */
    public function deliveries(): HasMany
    {
        return $this->hasMany(SubscriptionDelivery::class);
    }

    /**
     * @return HasMany<SubscriptionEvent, $this>
     */
    public function events(): HasMany
    {
        return $this->hasMany(SubscriptionEvent::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function canceller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancelled_by');
    }
}
