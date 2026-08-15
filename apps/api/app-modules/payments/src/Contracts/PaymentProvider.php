<?php

declare(strict_types=1);

namespace Healthy360\Payments\Contracts;

use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Payments\Models\PaymentIntent;

interface PaymentProvider
{
    public function supports(PaymentMethodKind $kind): bool;

    /**
     * Authorize or register an intent with the provider. Never receives PAN data.
     *
     * @param  array<string, mixed>  $context
     */
    public function authorize(PaymentIntent $intent, array $context = []): PaymentIntent;

    public function capture(PaymentIntent $intent): PaymentIntent;

    public function cancel(PaymentIntent $intent): PaymentIntent;
}
