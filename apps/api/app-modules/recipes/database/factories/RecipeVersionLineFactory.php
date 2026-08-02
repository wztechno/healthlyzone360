<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RecipeVersionLine>
 */
class RecipeVersionLineFactory extends Factory
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
            'line_number' => 1,
            'ingredient_id' => Ingredient::factory(),
            'quantity' => 100,
            'unit_id' => fn (): ?string => MeasurementUnit::query()->where('code', 'g')->value('id'),
            'unit_cost_amount' => null,
            'line_cost_amount' => null,
            'cost_currency_code' => null,
            'source_designation' => null,
            'comment' => null,
        ];
    }

    /**
     * A line with no amount — legal only while the version is unpublished, and
     * exactly what the sauces-and-dressings source provides.
     */
    public function unquantified(): static
    {
        return $this->state(fn (array $attributes): array => ['quantity' => null, 'unit_id' => null]);
    }
}
