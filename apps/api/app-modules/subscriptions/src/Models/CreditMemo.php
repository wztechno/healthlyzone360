<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Subscriptions\Enums\CreditMemoStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What a kitchen owes a customer whose subscription was cancelled early.
 *
 * A record of an obligation, not of a payment. Nothing in this class moves
 * money, and `settle()` records only that a human says it moved.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $customer_account_id
 * @property string $subscription_id
 * @property string $reason
 * @property int $unused_days
 * @property int $per_day_minor
 * @property int $amount_minor
 * @property string $currency_code
 * @property CreditMemoStatus $status
 * @property CarbonImmutable $recorded_at
 * @property CarbonImmutable|null $settled_at
 * @property string|null $settled_by
 * @property string|null $settlement_note
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Subscription|null $subscription
 * @property-read CustomerAccount|null $customerAccount
 * @property-read User|null $settler
 */
#[Classified(DataClassification::Confidential, 'per_day_minor', 'amount_minor', 'settlement_note')]
class CreditMemo extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => CreditMemoStatus::class,
            'unused_days' => 'integer',
            'per_day_minor' => 'integer',
            'amount_minor' => 'integer',
            'recorded_at' => 'datetime',
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
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class, 'customer_account_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function settler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'settled_by');
    }
}
