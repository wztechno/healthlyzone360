<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Factories;

use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Role>
 */
class RoleFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'code' => 'role_'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => fake()->jobTitle(),
            'name_ar' => 'دور '.fake()->word(),
            'is_system' => false,
        ];
    }

    /**
     * A platform template role (organisation_id NULL, is_system true).
     */
    public function template(): static
    {
        return $this->state(fn (array $attributes) => [
            'organisation_id' => null,
            'is_system' => true,
        ]);
    }
}
