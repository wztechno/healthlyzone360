<?php

declare(strict_types=1);

namespace Healthy360\Consent\Database\Factories;

use Healthy360\Consent\Models\ConsentDefinition;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConsentDefinition>
 */
class ConsentDefinitionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'consent.test_'.fake()->unique()->numberBetween(1, 999999),
            'version' => 1,
            'purpose' => fake()->sentence(),
            'body_en' => fake()->paragraph(),
            'body_ar' => 'نص الموافقة للاختبار.',
            'is_active' => true,
        ];
    }
}
