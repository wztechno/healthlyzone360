<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories;

use Healthy360\Customers\Enums\FoodExclusionKind;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\ReferenceData\Models\DietClassification;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CustomerFoodExclusion>
 */
class CustomerFoodExclusionFactory extends Factory
{
    /**
     * Free text by default — the form that needs no other table to exist, and
     * the one the `num_nonnulls` CHECK is easiest to violate by accident.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'customer_dietary_profile_id' => CustomerDietaryProfile::factory()->declared(),
            'kind' => FoodExclusionKind::Dislike,
            'ingredient_id' => null,
            'diet_classification_id' => null,
            'free_text' => fake()->word(),
            'declared_at' => now(),
        ];
    }

    /**
     * The identified forms clear the other two columns, because exactly one
     * subject is a database constraint rather than a convention.
     */
    public function forIngredient(Ingredient $ingredient): static
    {
        return $this->state(fn (): array => [
            'ingredient_id' => $ingredient->getKey(),
            'diet_classification_id' => null,
            'free_text' => null,
        ]);
    }

    public function forDietClassification(DietClassification $classification): static
    {
        return $this->state(fn (): array => [
            'ingredient_id' => null,
            'diet_classification_id' => $classification->getKey(),
            'free_text' => null,
        ]);
    }

    public function forbidden(): static
    {
        return $this->state(fn (): array => ['kind' => FoodExclusionKind::Forbidden]);
    }
}
