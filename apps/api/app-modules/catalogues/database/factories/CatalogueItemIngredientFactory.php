<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Ingredients\Models\Ingredient;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogueItemIngredient>
 */
class CatalogueItemIngredientFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_id' => CatalogueItem::factory(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItem::withoutTenancy()
                ->whereKey($attributes['catalogue_item_id'] ?? null)
                ->value('organisation_id'),
            'ingredient_id' => Ingredient::factory(),
            'is_representative' => false,
            'display_order' => 1,
        ];
    }

    public function representative(): static
    {
        return $this->state(fn (array $attributes): array => ['is_representative' => true]);
    }
}
