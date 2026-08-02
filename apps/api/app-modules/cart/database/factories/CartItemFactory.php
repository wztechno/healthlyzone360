<?php

declare(strict_types=1);

namespace Healthy360\Cart\Database\Factories;

use Healthy360\Cart\Models\CartItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CartItem>
 */
class CartItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_variant_id' => null,
            'quantity' => '1.0000',
            'delivery_date' => null,
        ];
    }
}
