<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Models\Recipe;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Recipe>
 */
class RecipeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = ucfirst(fake()->unique()->word().' '.fake()->word());

        return [
            'organisation_id' => Organisation::factory(),
            'branch_id' => null,
            'slug' => str($name)->slug()->value().'-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => $name,
            'name_ar' => 'وصفة '.fake()->word(),
            'recipe_category' => 'sauce',
            'source_kind' => null,
            'confidentiality' => RecipeConfidentiality::Confidential,
            'status' => RecipeStatus::Active,
            'notes' => null,
            'lock_version' => 0,
        ];
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => RecipeStatus::Archived]);
    }
}
