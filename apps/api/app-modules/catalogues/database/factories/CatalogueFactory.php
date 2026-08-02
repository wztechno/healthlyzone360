<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\CatalogueStatus;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Catalogue>
 */
class CatalogueFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'branch_id' => null,
            'code' => 'catalogue-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => 'Range '.fake()->word(),
            'name_ar' => 'تشكيلة '.fake()->word(),
            'status' => CatalogueStatus::Active,
            'lock_version' => 0,
        ];
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => CatalogueStatus::Archived]);
    }
}
