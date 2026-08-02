<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RecipeVersionOutput>
 */
class RecipeVersionOutputFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'recipe_version_id' => RecipeVersion::factory(),
            'organisation_id' => fn (array $attributes): ?string => RecipeVersion::withoutTenancy()
                ->whereKey($attributes['recipe_version_id'] ?? null)
                ->value('organisation_id'),
            'ingredient_id' => Ingredient::factory(),
            'output_quantity' => 1000,
            'unit_id' => fn (): ?string => MeasurementUnit::query()->where('code', 'g')->value('id'),
            'is_primary' => false,
        ];
    }

    public function primary(): static
    {
        return $this->state(fn (array $attributes): array => ['is_primary' => true]);
    }
}
