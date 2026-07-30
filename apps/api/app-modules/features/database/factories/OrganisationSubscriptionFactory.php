<?php

declare(strict_types=1);

namespace Healthy360\Features\Database\Factories;

use Healthy360\Features\Enums\SubscriptionStatus;
use Healthy360\Features\Models\OrganisationSubscription;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrganisationSubscription>
 */
class OrganisationSubscriptionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'package_code' => 'foundation',
            'status' => SubscriptionStatus::Active,
            'starts_at' => now()->subDay(),
            'ends_at' => null,
            'lock_version' => 0,
        ];
    }

    public function trial(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => SubscriptionStatus::Trial,
            'ends_at' => now()->addDays(14),
        ]);
    }

    public function lapsed(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => SubscriptionStatus::Lapsed,
            'ends_at' => now()->subDay(),
        ]);
    }
}
