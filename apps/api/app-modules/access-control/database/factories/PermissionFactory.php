<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Factories;

use Healthy360\AccessControl\Models\Permission;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Permission>
 */
class PermissionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $domain = fake()->randomElement(['organisation', 'branch', 'membership', 'role', 'profile']);

        return [
            'code' => $domain.'.action_'.fake()->unique()->numberBetween(1, 999999),
            'domain' => $domain,
            'description' => fake()->sentence(),
            'is_assignable' => true,
        ];
    }

    public function notAssignable(): static
    {
        return $this->state(fn (array $attributes) => ['is_assignable' => false]);
    }
}
