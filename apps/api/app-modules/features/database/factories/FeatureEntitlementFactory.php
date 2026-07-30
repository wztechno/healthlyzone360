<?php

declare(strict_types=1);

namespace Healthy360\Features\Database\Factories;

use Healthy360\Features\Enums\EntitlementStatus;
use Healthy360\Features\Models\FeatureDefinition;
use Healthy360\Features\Models\FeatureEntitlement;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FeatureEntitlement>
 */
class FeatureEntitlementFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'feature_definition_id' => FeatureDefinition::factory(),
            'status' => EntitlementStatus::Enabled,
            'starts_at' => null,
            'expires_at' => null,
            'lock_version' => 0,
        ];
    }

    public function trial(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => EntitlementStatus::Trial,
            'expires_at' => now()->addDays(30),
        ]);
    }

    public function disabled(): static
    {
        return $this->state(fn (array $attributes) => ['status' => EntitlementStatus::Disabled]);
    }

    public function expired(): static
    {
        return $this->state(fn (array $attributes) => [
            'starts_at' => now()->subMonth(),
            'expires_at' => now()->subDay(),
        ]);
    }
}
