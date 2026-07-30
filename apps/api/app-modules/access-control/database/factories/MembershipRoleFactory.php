<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Database\Factories;

use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MembershipRole>
 */
class MembershipRoleFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'membership_id' => OrganisationMembership::factory(),
            'organisation_id' => fn (array $attributes): ?string => OrganisationMembership::withoutTenancy()
                ->whereKey($attributes['membership_id'])
                ->value('organisation_id'),
            'role_id' => fn (array $attributes) => Role::factory()->create([
                'organisation_id' => $attributes['organisation_id'],
            ])->getKey(),
            'starts_at' => null,
            'expires_at' => null,
        ];
    }

    public function notStarted(): static
    {
        return $this->state(fn (array $attributes) => ['starts_at' => now()->addDay()]);
    }

    public function expired(): static
    {
        return $this->state(fn (array $attributes) => [
            'starts_at' => now()->subMonth(),
            'expires_at' => now()->subDay(),
        ]);
    }
}
