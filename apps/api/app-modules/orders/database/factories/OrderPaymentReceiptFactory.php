<?php

declare(strict_types=1);

namespace Healthy360\Orders\Database\Factories;

use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<OrderPaymentReceipt>
 */
class OrderPaymentReceiptFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        // No defaults for the kitchen, the order or the person confirming it,
        // for the reason `OrderFactory` gives: a receipt whose organisation does
        // not own the order it pays for is not a state any test wants to reason
        // about, and three unrelated factories would build exactly that.
        return [
            'method' => PaymentMethod::CashOnDelivery,
            'amount_minor' => 3000,
            'currency_code' => 'USD',
            'reference' => null,
            'confirmed_at' => now(),
            'notes' => null,
        ];
    }

    public function cashAtCounter(): static
    {
        return $this->state(fn (): array => ['method' => PaymentMethod::CashAtCounter]);
    }

    /**
     * A WISH transfer, which is the one method that arrives with a reference:
     * the transaction identifier the desk read off the merchant app. Cash has
     * no such thing, which is why the base state leaves it null.
     */
    public function wish(): static
    {
        return $this->state(fn (): array => [
            'method' => PaymentMethod::Wish,
            'reference' => 'WSH-'.Str::upper(Str::random(10)),
        ]);
    }
}
