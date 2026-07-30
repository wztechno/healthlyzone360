<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Database\Factories;

use App\Models\User;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganisationMembership>
 */
class OrganisationMembershipFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'user_id' => User::factory(),
            'branch_id' => null,
            'status' => MembershipStatus::Active,
            'joined_at' => now(),
            'lock_version' => 0,
        ];
    }

    public function invited(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => MembershipStatus::Invited,
            'joined_at' => null,
        ]);
    }

    public function suspended(): static
    {
        return $this->state(fn (array $attributes) => ['status' => MembershipStatus::Suspended]);
    }

    public function ended(): static
    {
        return $this->state(fn (array $attributes) => ['status' => MembershipStatus::Ended]);
    }
}
