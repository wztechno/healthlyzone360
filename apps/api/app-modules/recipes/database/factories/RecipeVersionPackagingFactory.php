<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * The sibling of {@see RecipeVersionLineFactory}, with the two differences the tables have.
 *
 * `quantity` is never null here. Two of the three bases compute their own figure and the third
 * requires one, so there is no `unquantified()` state to mirror — the nullability on a formulation
 * line exists because the sauces source lists ingredients with no amounts, and no equivalent source
 * gap exists for a box.
 *
 * The default basis is `per_batch`, the one a caller states outright. `fills_yield` and
 * `per_container` are derived by `RecipeVersionService::preparePackaging()` from the version's yield
 * and the item's capacity, so a factory picking either would be writing a number the service is the
 * only thing entitled to compute — a fixture that happens to agree today and silently disagrees the
 * first time somebody changes the yield.
 *
 * @extends Factory<RecipeVersionPackaging>
 */
class RecipeVersionPackagingFactory extends Factory
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
            'basis' => PackagingBasis::PerBatch,
            'quantity' => 1,
            'unit_id' => fn (): ?string => MeasurementUnit::query()->where('code', 'piece')->value('id'),
            'unit_cost_amount' => null,
            'line_cost_amount' => null,
            'cost_currency_code' => null,
            'comment' => null,
        ];
    }
}
