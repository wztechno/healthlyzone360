<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RecipeVersionAllergen>
 */
class RecipeVersionAllergenFactory extends Factory
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
            'allergen_code' => fn (): string => (string) (Allergen::query()->value('code') ?? Allergen::factory()->create()->code),
            'containment' => AllergenContainment::Contains,
            'derivation' => AllergenDerivation::Declared,
            'source_ingredient_id' => null,
            'source_note' => null,
        ];
    }
}
