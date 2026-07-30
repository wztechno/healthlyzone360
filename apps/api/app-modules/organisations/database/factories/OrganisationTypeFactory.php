<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Database\Factories;

use Healthy360\Organisations\Models\OrganisationType;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganisationType>
 */
class OrganisationTypeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => fake()->unique()->slug(2, false),
            'name_en' => fake()->words(2, true),
            'name_ar' => 'نوع '.fake()->word(),
            'is_active' => true,
        ];
    }
}
