<?php

declare(strict_types=1);

namespace Healthy360\Orders\Database\Factories;

use Healthy360\Orders\Models\OrderLine;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrderLine>
 */
class OrderLineFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_variant_id' => null,
            'name_en' => 'Chicken freekeh bowl',
            'name_ar' => 'وعاء الفريكة بالدجاج',
            'variant_label' => null,
            'quantity' => '1.0000',
            'unit_price_minor' => 2500,
            'line_total_minor' => 2500,
            'currency_code' => 'USD',
            'allergens' => [],
            'pack_summary' => null,
            'price_list_id' => null,
            'price_list_item_id' => null,
        ];
    }
}
