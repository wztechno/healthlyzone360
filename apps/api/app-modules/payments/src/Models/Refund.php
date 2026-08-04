<?php

declare(strict_types=1);

namespace Healthy360\Payments\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $payment_intent_id
 * @property int $amount_minor
 * @property string $currency_code
 * @property string $status
 * @property string|null $provider_ref
 * @property CarbonImmutable|null $completed_at
 */
class Refund extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount_minor' => 'integer',
            'completed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<PaymentIntent, $this>
     */
    public function paymentIntent(): BelongsTo
    {
        return $this->belongsTo(PaymentIntent::class);
    }
}
