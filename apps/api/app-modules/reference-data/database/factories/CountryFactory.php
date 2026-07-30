<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Factories;

use Healthy360\ReferenceData\Models\Country;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Country>
 */
class CountryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->countryCode(),
            'name_en' => fake()->country(),
            'name_ar' => 'بلد '.fake()->word(),
            'default_currency_code' => null,
            'is_active' => false,
        ];
    }

    public function active(): static
    {
        return $this->state(fn (array $attributes) => ['is_active' => true]);
    }
}
