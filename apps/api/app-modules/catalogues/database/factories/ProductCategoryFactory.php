<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\ProductCategory;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ProductCategory>
 */
class ProductCategoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            // Null by default: the common case is a platform library row, and
            // a factory that invented an organisation would make every test
            // that wanted one build a tenant it never uses.
            'organisation_id' => null,
            'code' => 'category-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => ucfirst(fake()->word()),
            'name_ar' => 'فئة '.fake()->word(),
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
