<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RecipeVersionStep>
 */
class RecipeVersionStepFactory extends Factory
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
            'step_number' => 1,
            'instruction_en' => fake()->sentence(6),
            'instruction_ar' => null,
            'minutes' => null,
        ];
    }
}
