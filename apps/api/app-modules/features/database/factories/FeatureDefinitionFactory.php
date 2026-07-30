<?php

declare(strict_types=1);

namespace Healthy360\Features\Database\Factories;

use Healthy360\Features\Models\FeatureDefinition;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FeatureDefinition>
 */
class FeatureDefinitionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'feature.test_'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => fake()->words(3, true),
            'name_ar' => 'ميزة '.fake()->word(),
            'description' => fake()->sentence(),
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => ['is_active' => false]);
    }
}
