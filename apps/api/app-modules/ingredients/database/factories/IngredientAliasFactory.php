<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Factories;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<IngredientAlias>
 */
class IngredientAliasFactory extends Factory
{
    /**
     * `alias_normalised` is deliberately absent: the model writes it on save,
     * and a factory that set it directly could produce a row no lookup would
     * ever find.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'ingredient_id' => Ingredient::factory(),
            'alias' => ucfirst(fake()->unique()->word().' '.fake()->word()),
            'locale' => null,
        ];
    }
}
