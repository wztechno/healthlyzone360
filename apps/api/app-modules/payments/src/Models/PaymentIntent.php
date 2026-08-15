<?php

declare(strict_types=1);

namespace Healthy360\Payments\Models;

use Carbon\CarbonImmutable;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Payment state for one order — keyed by order_id, not columns on orders.
 *
 * **Organisation-scoped to the kitchen being paid, not to the person paying.**
 * `organisation_id` has always been copied from the order's, and the order's
 * is the seller's; the column simply had no scope on it, so `whereKey()` on
 * the capture and refund endpoints resolved any tenant's intent to any
 * verified caller. The scope is the seller's because capture and refund are
 * the seller's acts — taking the money and giving it back are decisions the
 * kitchen makes — and because the buyer already has a scope of their own,
 * `OrderLocator`, which is what guards the buyer-side create.
 *
 * Two read paths legitimately run outside a tenant context and say so at the
 * call site: `PaymentService::createIntentForOrder()`, which is reached from
 * the customer surface where no organisation is published, and
 * `PaymentsInvoicingSettlementLookup`, whose only caller is a platform
 * operator holding the *platform's* organisation while asking about a
 * corporate customer's (the D-066 finding). Both use `withoutTenancy()` and
 * name their own organisation predicate.
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
class PaymentIntent extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

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
