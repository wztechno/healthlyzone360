<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Factories;

use Healthy360\ReferenceData\Models\DeliveryArea;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeliveryArea>
 */
class DeliveryAreaFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $code = 'area-'.fake()->unique()->numberBetween(1, 999999);

        return [
            'country_code' => 'LB',
            'code' => $code,
            'name_en' => ucfirst(fake()->word()),
            'name_ar' => 'منطقة '.fake()->word(),
            'region' => null,
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    public function inCountry(string $countryCode): static
    {
        return $this->state(fn (array $attributes): array => ['country_code' => $countryCode]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
