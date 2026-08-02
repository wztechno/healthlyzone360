<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MealCombinationOption>
 */
class MealCombinationOptionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'code' => 'combination-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => 'Lunch and dinner',
            'name_ar' => 'الغداء والعشاء',
            'includes_breakfast' => false,
            'includes_lunch' => true,
            'includes_dinner' => true,
            'meals_per_day' => 2,
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    public function fullDay(): static
    {
        return $this->state(fn (array $attributes): array => [
            'name_en' => 'Full day',
            'name_ar' => 'اليوم الكامل',
            'includes_breakfast' => true,
            'includes_lunch' => true,
            'includes_dinner' => true,
            'meals_per_day' => 3,
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
