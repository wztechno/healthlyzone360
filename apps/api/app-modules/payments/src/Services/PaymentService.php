<?php

declare(strict_types=1);

namespace Healthy360\Payments\Services;

use Healthy360\Payments\Contracts\PaymentProvider;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Payments\Models\PaymentIntent;
use Healthy360\Payments\Models\Refund;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

final readonly class PaymentService
{
    /** @var list<PaymentProvider> */
    private array $providers;

    public function __construct(
        CodPaymentProvider $cod,
        FakeCardPaymentProvider $fakeCard,
    ) {
        $this->providers = [$cod, $fakeCard];
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function createIntentForOrder(
        string $organisationId,
        string $orderId,
        PaymentMethodKind $kind,
        string $currencyCode,
        int $amountMinor,
        array $context = [],
    ): PaymentIntent {
        $existing = PaymentIntent::query()->where('order_id', $orderId)->first();
        if ($existing !== null) {
            throw new ApiException(ErrorCode::ResourceConflict, 'A payment intent already exists for this order.');
        }

        $intent = PaymentIntent::query()->create([
            'organisation_id' => $organisationId,
            'order_id' => $orderId,
            'method_kind' => $kind,
            'currency_code' => $currencyCode,
            'amount_minor' => $amountMinor,
            'status' => PaymentIntentStatus::Pending,
        ]);

        return $this->providerFor($kind)->authorize($intent, $context);
    }

    public function capture(PaymentIntent $intent): PaymentIntent
    {
        if (! $intent->isCapturable()) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This payment intent cannot be captured in its current state.');
        }

        return $this->providerFor($intent->method_kind)->capture($intent);
    }

    public function refund(PaymentIntent $intent, int $amountMinor): Refund
    {
        if ($intent->status !== PaymentIntentStatus::Captured) {
            throw new ApiException(ErrorCode::ResourceConflict, 'Only captured payments may be refunded.');
        }

        return DB::transaction(function () use ($intent, $amountMinor): Refund {
            $refund = Refund::query()->create([
                'payment_intent_id' => $intent->getKey(),
                'amount_minor' => $amountMinor,
                'currency_code' => $intent->currency_code,
                'status' => 'completed',
                'completed_at' => now(),
            ]);

            return $refund;
        });
    }

    private function providerFor(PaymentMethodKind $kind): PaymentProvider
    {
        foreach ($this->providers as $provider) {
            if ($provider->supports($kind)) {
                return $provider;
            }
        }

        throw new ApiException(ErrorCode::RequestInvalid, 'No payment provider is configured for this method.');
    }
}
