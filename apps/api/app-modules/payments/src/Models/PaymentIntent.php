<?php

declare(strict_types=1);

namespace Healthy360\Payments\Models;

use Carbon\CarbonImmutable;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Payment state for one order — keyed by order_id, not columns on orders.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property string|null $payment_method_record_id
 * @property PaymentIntentStatus $status
 * @property PaymentMethodKind $method_kind
 * @property string $currency_code
 * @property int $amount_minor
 * @property string|null $provider
 * @property string|null $provider_ref
 * @property CarbonImmutable|null $authorized_at
 * @property CarbonImmutable|null $captured_at
 * @property CarbonImmutable|null $failed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property string|null $failure_reason
 * @property int $lock_version
 */
class PaymentIntent extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => PaymentIntentStatus::class,
            'method_kind' => PaymentMethodKind::class,
            'amount_minor' => 'integer',
            'lock_version' => 'integer',
            'authorized_at' => 'immutable_datetime',
            'captured_at' => 'immutable_datetime',
            'failed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<PaymentMethodRecord, $this>
     */
    public function paymentMethodRecord(): BelongsTo
    {
        return $this->belongsTo(PaymentMethodRecord::class);
    }

    /**
     * @return HasMany<Refund, $this>
     */
    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class);
    }

    public function isCapturable(): bool
    {
        return $this->status === PaymentIntentStatus::Authorized
            || ($this->status === PaymentIntentStatus::Pending && $this->method_kind === PaymentMethodKind::CashOnDelivery);
    }
}
