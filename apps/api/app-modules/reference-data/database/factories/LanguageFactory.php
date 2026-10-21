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
            'code' => fn (): string => $this->unusedCode(),
            'name_en' => fake()->word(),
            'name_native' => fake()->word(),
            'direction' => 'ltr',
            'is_active' => false,
        ];
    }

    /**
     * A code no row holds yet. Faker's uniqueness only knows what it handed out,
     * not what a seeder already inserted, so a test that seeds languages and then
     * builds one (a user profile does) would otherwise hit "ar" now and then.
     */
    private function unusedCode(): string
    {
        do {
            $code = fake()->unique()->languageCode();
        } while (Language::query()->whereKey($code)->exists());

        return $code;
    }

    public function rtl(): static
    {
        return $this->state(fn (array $attributes) => ['direction' => 'rtl']);
    }
}
