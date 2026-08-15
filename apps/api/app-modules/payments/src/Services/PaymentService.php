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
        // `withoutTenancy()` because this runs on the customer surface, where
        // no organisation is published and the fail-closed scope would throw
        // rather than answer. The predicate that matters is the order, and the
        // order was already scoped to the caller's own customer account by
        // `OrderLocator` before it reached here.
        $existing = PaymentIntent::withoutTenancy()->where('order_id', $orderId)->first();
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

    /**
     * @throws ApiException
     */
    public function capture(PaymentIntent $intent): PaymentIntent
    {
        return DB::transaction(function () use ($intent): PaymentIntent {
            $locked = $this->lock($intent);

            if (! $locked->isCapturable()) {
                throw new ApiException(ErrorCode::ResourceConflict, 'This payment intent cannot be captured in its current state.');
            }

            return $this->providerFor($locked->method_kind)->capture($locked);
        });
    }

    /**
     * Record a refund against a captured intent.
     *
     * **The cap is the capture, less everything already refunded.** Without
     * it the endpoint would pay out an unbounded number of times against one
     * payment, and the check has to be read *and* written inside the same
     * transaction against a locked row: two refunds racing on a check-then-act
     * would both read the same total, both find room, and jointly exceed it.
     * `lockForUpdate()` on the intent is what serialises them — the intent
     * rather than the refunds, because the row being protected is the one that
     * says how much money there is, and a lock on rows that do not exist yet
     * would stop nothing.
     *
     * @throws ApiException
     */
    public function refund(PaymentIntent $intent, int $amountMinor): Refund
    {
        return DB::transaction(function () use ($intent, $amountMinor): Refund {
            $locked = $this->lock($intent);

            if ($locked->status !== PaymentIntentStatus::Captured) {
                throw new ApiException(ErrorCode::ResourceConflict, 'Only captured payments may be refunded.');
            }

            $refunded = (int) Refund::query()
                ->where('payment_intent_id', $locked->getKey())
                ->whereIn('status', ['pending', 'completed'])
                ->sum('amount_minor');

            $refundable = $locked->amount_minor - $refunded;

            if ($amountMinor > $refundable) {
                throw new ApiException(ErrorCode::PaymentRefundExceedsCapture, details: [
                    'captured_minor' => $locked->amount_minor,
                    'refunded_minor' => $refunded,
                    'refundable_minor' => max($refundable, 0),
                ]);
            }

            return Refund::query()->create([
                'payment_intent_id' => $locked->getKey(),
                'amount_minor' => $amountMinor,
                'currency_code' => $locked->currency_code,
                'status' => 'completed',
                'completed_at' => now(),
            ]);
        });
    }

    /**
     * The same intent, re-read `FOR UPDATE` so a concurrent capture or refund
     * queues behind this one instead of racing it.
     *
     * The organisation scope applies to the re-read as it did to the lookup
     * that produced the argument, which is deliberate: the row a caller may
     * lock is exactly the row they may see, and a scope dropped for
     * convenience halfway through a write is how a boundary stops being one.
     * A `null` here means the row went away between the two reads, and a
     * caller holding an identifier for a payment that no longer exists is owed
     * the same answer as one holding an identifier that never did.
     *
     * @throws ApiException
     */
    private function lock(PaymentIntent $intent): PaymentIntent
    {
        $locked = PaymentIntent::query()
            ->whereKey($intent->getKey())
            ->lockForUpdate()
            ->first();

        if (! $locked instanceof PaymentIntent) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $locked;
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
