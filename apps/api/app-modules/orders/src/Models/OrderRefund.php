<?php

declare(strict_types=1);

namespace Healthy360\Orders\Models;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Enums\OrderRefundKind;
use Healthy360\Orders\Enums\OrderRefundStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One entry on an order's refund ledger. Written through `OrderRefunds` and
 * nowhere else; the migration explains the two kinds and the append-only trigger.
 *
 * `reason` is `Confidential` for the reason `OrderPaymentReceipt::notes` is: free
 * text typed at a counter is where somebody puts a customer's name.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property OrderRefundKind $kind
 * @property OrderRefundStatus $status
 * @property PaymentMethod $method
 * @property int $amount_minor
 * @property string $currency_code
 * @property string $reason
 * @property string $requested_by
 * @property CarbonImmutable $requested_at
 * @property string|null $decided_by
 * @property CarbonImmutable|null $decided_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'reason')]
#[Classified(DataClassification::Internal, 'kind', 'status', 'method', 'amount_minor', 'currency_code', 'requested_by', 'requested_at', 'decided_by', 'decided_at')]
class OrderRefund extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => OrderRefundKind::class,
            'status' => OrderRefundStatus::class,
            'method' => PaymentMethod::class,
            'amount_minor' => 'integer',
            'requested_at' => 'immutable_datetime',
            'decided_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
