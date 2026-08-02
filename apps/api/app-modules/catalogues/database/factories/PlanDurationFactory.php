<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PlanDuration>
 */
class PlanDurationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'code' => 'duration-'.fake()->unique()->numberBetween(1, 999999),
            'duration_kind' => PlanDurationKind::FixedDays,
            'duration_days' => 20,
            'name_en' => '20 days',
            'name_ar' => '٢٠ يوماً',
            'display_order' => 0,
            'is_active' => true,
        ];
    }

    /**
     * The shape the zero-day sentinel used to occupy: a single purchase, with
     * no number of days at all (§4.3).
     */
    public function oneOff(): static
    {
        return $this->state(fn (array $attributes): array => [
            'duration_kind' => PlanDurationKind::OneOff,
            'duration_days' => null,
            'name_en' => 'One-off order',
            'name_ar' => 'طلب لمرة واحدة',
        ]);
    }

    public function days(int $days): static
    {
        return $this->state(fn (array $attributes): array => [
            'duration_kind' => PlanDurationKind::FixedDays,
            'duration_days' => $days,
            'name_en' => $days.' days',
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
