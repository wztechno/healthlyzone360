<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Database\Factories;

use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeliveryWindow>
 */
class DeliveryWindowFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'code' => 'window-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => 'Morning',
            'name_ar' => 'صباحاً',
            'starts_at' => '09:00:00',
            'ends_at' => '12:00:00',
            'weekdays' => [],
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    /**
     * @param  list<int>  $weekdays
     */
    public function on(array $weekdays): static
    {
        return $this->state(fn (array $attributes): array => ['weekdays' => $weekdays]);
    }

    /**
     * A window somebody named before deciding its hours — legitimate, and the
     * state the "both ends or neither" rule has to tolerate.
     */
    public function untimed(): static
    {
        return $this->state(fn (array $attributes): array => ['starts_at' => null, 'ends_at' => null]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
