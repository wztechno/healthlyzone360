<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Factories;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<IngredientAllergen>
 */
class IngredientAllergenFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'ingredient_id' => Ingredient::factory(),
            'allergen_code' => fn (): string => (string) (Allergen::query()->value('code') ?? Allergen::factory()->create()->code),
            'organisation_id' => null,
            'containment' => AllergenContainment::Contains,
            'market_scope' => AllergenMarketScope::All,
            'source' => AllergenMappingSource::MasterList,
            'verification_status' => AllergenVerificationStatus::Unverified,
            'evidence' => null,
        ];
    }
}
