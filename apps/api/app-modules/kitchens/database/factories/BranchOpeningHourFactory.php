<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Database\Factories;

use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BranchOpeningHour>
 */
class BranchOpeningHourFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'branch_id' => OrganisationBranch::factory(),
            'weekday' => 1,
            'opens_at' => '08:00:00',
            'closes_at' => '20:00:00',
            'order_cut_off_at' => '18:00:00',
        ];
    }

    public function onWeekday(int $weekday): static
    {
        return $this->state(fn (array $attributes): array => ['weekday' => $weekday]);
    }

    /**
     * A closed day — a row with no times at all, which is what distinguishes
     * "shut on Sunday" from "nobody has filled in Sunday".
     */
    public function closed(): static
    {
        return $this->state(fn (array $attributes): array => [
            'opens_at' => null,
            'closes_at' => null,
            'order_cut_off_at' => null,
        ]);
    }
}
