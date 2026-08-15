<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Database\Factories;

use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeliveryZone>
 */
class DeliveryZoneFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'branch_id' => null,
            'code' => 'zone-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => 'Inner city',
            'name_ar' => 'المدينة الداخلية',
            'currency_code' => 'USD',
            'delivery_fee_minor' => 300,
            'minimum_order_minor' => 2500,
            'estimated_minutes' => 45,
            'status' => DeliveryZoneStatus::Active,
            'lock_version' => 0,
        ];
    }

    public function forBranch(string $branchId): static
    {
        return $this->state(fn (array $attributes): array => ['branch_id' => $branchId]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => DeliveryZoneStatus::Inactive]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => DeliveryZoneStatus::Archived]);
    }

    /**
     * A zone nobody has priced — the honest half-configured state, and the one
     * a test asserting "NULL is not zero" needs to be able to build.
     */
    public function unpriced(): static
    {
        return $this->state(fn (array $attributes): array => [
            'delivery_fee_minor' => null,
            'minimum_order_minor' => null,
            'estimated_minutes' => null,
        ]);
    }
}
