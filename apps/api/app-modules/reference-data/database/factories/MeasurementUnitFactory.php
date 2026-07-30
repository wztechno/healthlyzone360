<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Factories;

use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MeasurementUnit>
 */
class MeasurementUnitFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->lexify('????'),
            'unit_system' => fake()->randomElement(['metric', 'imperial', 'clinical']),
            'name_en' => fake()->word(),
            'name_ar' => 'وحدة '.fake()->word(),
            'is_active' => true,
        ];
    }
}
