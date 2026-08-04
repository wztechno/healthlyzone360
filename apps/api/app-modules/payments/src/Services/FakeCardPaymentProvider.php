<?php

declare(strict_types=1);

namespace Healthy360\Payments\Services;

use Healthy360\Payments\Contracts\PaymentProvider;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Payments\Models\PaymentIntent;
use Illuminate\Support\Str;

/**
 * Sandbox card provider — simulates authorize/capture without touching PAN data.
 */
final readonly class FakeCardPaymentProvider implements PaymentProvider
{
    public function supports(PaymentMethodKind $kind): bool
    {
        return $kind === PaymentMethodKind::Card;
    }

    public function authorize(PaymentIntent $intent, array $context = []): PaymentIntent
    {
        $intent->status = PaymentIntentStatus::Authorized;
        $intent->provider = 'fake_card_sandbox';
        $intent->provider_ref = 'sandbox_'.Str::lower(Str::random(12));
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
