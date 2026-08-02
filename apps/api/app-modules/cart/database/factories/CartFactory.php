<?php

declare(strict_types=1);

namespace Healthy360\Cart\Database\Factories;

use Healthy360\Cart\Enums\CartStatus;
use Healthy360\Cart\Models\Cart;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Cart>
 */
class CartFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        // No factory defaults for the three owners. A cart is only meaningful
        // against a customer, a channel and the organisation that channel
        // belongs to, and inventing three unrelated ones would build a basket
        // whose kitchen does not sell what its channel offers.
        return [
            'branch_id' => null,
            'status' => CartStatus::Open,
            'currency_code' => 'USD',
            'expires_at' => now()->addDays(3),
            'lock_version' => 0,
        ];
    }

    public function converted(): static
    {
        return $this->state(fn (): array => ['status' => CartStatus::Converted]);
    }

    /** Past its window — what the expiry sweep looks for. */
    public function stale(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subDay()]);
    }
}
