<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Factories;

use Healthy360\ReferenceData\Models\DietClassification;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DietClassification>
 */
class DietClassificationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'diet_'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => ucfirst(fake()->word()),
            'name_ar' => 'حمية '.fake()->word(),
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
