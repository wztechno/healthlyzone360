<?php

declare(strict_types=1);

namespace Healthy360\Payments\Services;

use Healthy360\Payments\Contracts\PaymentProvider;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Payments\Models\PaymentIntent;

final readonly class CodPaymentProvider implements PaymentProvider
{
    public function supports(PaymentMethodKind $kind): bool
    {
        return $kind === PaymentMethodKind::CashOnDelivery;
    }

    public function authorize(PaymentIntent $intent, array $context = []): PaymentIntent
    {
        $intent->status = PaymentIntentStatus::Authorized;
        $intent->provider = 'cod';
        $intent->authorized_at = now();
        $intent->save();

        return $intent;
    }

    public function capture(PaymentIntent $intent): PaymentIntent
    {
        $intent->status = PaymentIntentStatus::Captured;
        $intent->captured_at = now();
        $intent->save();

        return $intent;
    }

    public function cancel(PaymentIntent $intent): PaymentIntent
    {
        $intent->status = PaymentIntentStatus::Cancelled;
        $intent->cancelled_at = now();
        $intent->save();

        return $intent;
    }
}
