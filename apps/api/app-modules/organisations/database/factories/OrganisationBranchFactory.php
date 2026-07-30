<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Database\Factories;

use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Models\Country;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganisationBranch>
 */
class OrganisationBranchFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'name' => fake()->city().' branch',
            'country_code' => Country::factory(),
            'city' => fake()->city(),
            'address' => fake()->streetAddress(),
            'timezone' => 'UTC',
            'status' => BranchStatus::Active,
            'lock_version' => 0,
        ];
    }

    public function closed(): static
    {
        return $this->state(fn (array $attributes) => ['status' => BranchStatus::Closed]);
    }
}
