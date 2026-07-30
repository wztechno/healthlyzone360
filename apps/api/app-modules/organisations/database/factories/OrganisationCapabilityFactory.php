<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Database\Factories;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationCapability;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganisationCapability>
 */
class OrganisationCapabilityFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'capability' => fake()->unique()->randomElement([
                'clinic_services', 'kitchen_production', 'fitness_programmes', 'wellness_services',
            ]).'_'.fake()->unique()->numberBetween(1, 9999),
            'is_enabled' => true,
        ];
    }

    public function disabled(): static
    {
        return $this->state(fn (array $attributes) => ['is_enabled' => false]);
    }
}
