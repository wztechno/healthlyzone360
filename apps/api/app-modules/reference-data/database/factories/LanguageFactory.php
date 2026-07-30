<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Factories;

use Healthy360\ReferenceData\Models\Language;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Language>
 */
class LanguageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->languageCode(),
            'name_en' => fake()->word(),
            'name_native' => fake()->word(),
            'direction' => 'ltr',
            'is_active' => false,
        ];
    }

    public function rtl(): static
    {
        return $this->state(fn (array $attributes) => ['direction' => 'rtl']);
    }
}
