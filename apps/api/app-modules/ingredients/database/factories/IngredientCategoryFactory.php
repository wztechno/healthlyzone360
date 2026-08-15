<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Factories;

use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<IngredientCategory>
 */
class IngredientCategoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'parent_id' => null,
            'code' => 'cat-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => fake()->word(),
            'name_ar' => 'فئة '.fake()->word(),
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    /**
     * A platform-library category (organisation_id NULL).
     */
    public function platform(): static
    {
        return $this->state(fn (array $attributes): array => ['organisation_id' => null]);
    }
}
