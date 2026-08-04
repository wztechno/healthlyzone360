<?php

declare(strict_types=1);

namespace Healthy360\Payments\Presenters;

use Healthy360\Payments\Models\PaymentIntent;
use Healthy360\Payments\Models\Refund;

final class PaymentPresenter
{
    /**
     * @return array<string, mixed>
     */
    public function intent(PaymentIntent $intent): array
    {
        return [
            'id' => (string) $intent->getKey(),
            'order_id' => $intent->order_id,
            'status' => $intent->status->value,
            'method_kind' => $intent->method_kind->value,
            'currency_code' => $intent->currency_code,
            'amount_minor' => $intent->amount_minor,
            'provider' => $intent->provider,
            'provider_ref' => $intent->provider_ref,
            'authorized_at' => $intent->authorized_at?->toIso8601String(),
            'captured_at' => $intent->captured_at?->toIso8601String(),
            'lock_version' => $intent->lock_version,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function refund(Refund $refund): array
    {
        return [
            'id' => (string) $refund->getKey(),
            'payment_intent_id' => $refund->payment_intent_id,
            'amount_minor' => $refund->amount_minor,
            'currency_code' => $refund->currency_code,
            'status' => $refund->status,
            'completed_at' => $refund->completed_at?->toIso8601String(),
        ];
    }
}
