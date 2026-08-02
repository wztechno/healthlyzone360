<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EnergyBand>
 */
class EnergyBandFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'code' => 'band-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => '1200–1500 kcal',
            'name_ar' => '١٢٠٠–١٥٠٠ سعرة',
            'min_kcal' => 1200,
            'max_kcal' => 1500,
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
