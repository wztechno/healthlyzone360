<?php

declare(strict_types=1);

namespace Healthy360\Audit\Database\Factories;

use App\Models\User;
use Healthy360\Audit\Models\AuditLog;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<AuditLog>
 */
class AuditLogFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'actor_user_id' => User::factory(),
            'organisation_id' => null,
            'branch_id' => null,
            'action' => fake()->randomElement(['membership.updated', 'role.assigned', 'organisation.updated']),
            'subject_type' => 'organisation_membership',
            'subject_id' => (string) Str::uuid7(),
            'purpose_of_use' => null,
            'correlation_id' => (string) Str::uuid7(),
            'metadata' => [],
            'occurred_at' => now(),
        ];
    }
}
