<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Factories;

use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Ingredient>
 */
class IngredientFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = ucfirst(fake()->unique()->word().' '.fake()->word());

        return [
            'organisation_id' => Organisation::factory(),
            'slug' => str($name)->slug()->value().'-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => $name,
            'name_ar' => 'مكوّن '.fake()->word(),
            'ingredient_category_id' => null,
            'ingredient_subcategory_id' => null,
            'default_unit_id' => fn (): string => (string) (MeasurementUnit::query()->where('code', 'g')->value('id')
                ?? MeasurementUnit::factory()->create(['code' => 'g'.fake()->unique()->numberBetween(1, 999999)])->getKey()),
            'yield_factor' => 1,
            'availability_tier' => null,
            'status' => IngredientStatus::Active,
            'verification_status' => IngredientVerificationStatus::Unverified,
            'notes' => null,
            'lock_version' => 0,
        ];
    }

    /**
     * A platform-library ingredient (organisation_id NULL) — the rows every
     * tenant reads and none may write.
     */
    public function platform(): static
    {
        return $this->state(fn (array $attributes): array => ['organisation_id' => null]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => IngredientStatus::Archived]);
    }
}
