<?php

declare(strict_types=1);

namespace Database\Seeders;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Services\AllergenRollupService;
use Healthy360\Recipes\Services\RecipeLabelWriter;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * Gives a demo meal cooked to order the recipe a sale explodes (HA-45).
 *
 * The publish gate refuses a meal with no recipe, an unpublished one, or one with
 * no piece count (`StockDeductionReadiness`), because without them every sale is a
 * silent non-deduction. The demo meals are display copy rather than formulations,
 * so the recipe written here is the honest minimum: one portion per batch, made of
 * the same ingredients the meal already lists, by weight. It claims no output — a
 * cooked-to-order meal has no shelf of its own.
 *
 * Keyed on the meal's slug, so a reseed converges on the version already written
 * rather than publishing a second one every run.
 *
 * The version's allergen label is frozen from its lines, as publication does, because
 * the marketplace reads a recipe meal's allergens from that label alone: a version
 * written without one would list the meal as allergen-free.
 */
final class DemoMealRecipeWriter
{
    public function __construct(
        private readonly AllergenRollupService $rollup,
        private readonly RecipeLabelWriter $labels,
    ) {}

    /**
     * @param  list<array{0: Ingredient, 1: int|float}>  $lines  ingredient → grams in one portion
     */
    public function link(Organisation $organisation, CatalogueItem $meal, array $lines): void
    {
        $recipe = Recipe::withoutTenancy()->firstOrCreate(
            ['organisation_id' => $organisation->getKey(), 'slug' => (string) $meal->slug],
            ['name_en' => (string) $meal->name_en, 'name_ar' => (string) $meal->name_ar],
        );

        $version = RecipeVersion::withoutTenancy()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', RecipeVersionStatus::Published->value)
            ->first() ?? $this->publishVersion($organisation, $recipe, $lines);

        $this->freezeLabel($version);

        $meal->forceFill(['recipe_id' => $recipe->getKey()])->save();
    }

    /**
     * @param  list<array{0: Ingredient, 1: int|float}>  $lines
     */
    private function publishVersion(Organisation $organisation, Recipe $recipe, array $lines): RecipeVersion
    {
        $gram = MeasurementUnit::query()->where('code', 'g')->sole();

        $portionGrams = array_sum(array_map(static fn (array $line): int|float => $line[1], $lines));

        $version = RecipeVersion::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'recipe_id' => $recipe->getKey(),
            'version_number' => ((int) RecipeVersion::withoutTenancy()->where('recipe_id', $recipe->getKey())->max('version_number')) + 1,
            'status' => RecipeVersionStatus::Published->value,
            'published_at' => CarbonImmutable::now(),
            'yield_quantity' => (string) $portionGrams,
            'yield_unit_id' => (string) $gram->getKey(),
            'yield_piece_count' => 1,
            'waste_coefficient_percent' => '0.00',
            'packaging_waste_percent' => '0.00',
        ]);

        foreach ($lines as $index => [$ingredient, $grams]) {
            RecipeVersionLine::withoutTenancy()->create([
                'organisation_id' => $organisation->getKey(),
                'recipe_version_id' => $version->getKey(),
                'line_number' => $index + 1,
                'ingredient_id' => (string) $ingredient->getKey(),
                'quantity' => (string) $grams,
                'unit_id' => (string) $gram->getKey(),
            ]);
        }

        return $version;
    }

    /**
     * Freeze the version's allergen label from its own lines, with the services
     * publication uses, so a reseed also labels a version an earlier run wrote bare.
     */
    private function freezeLabel(RecipeVersion $version): void
    {
        /** @var list<string> $ingredientIds */
        $ingredientIds = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('line_number')
            ->pluck('ingredient_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $effective = $this->rollup->effectiveFor(array_values(array_unique($ingredientIds)), (string) $version->organisation_id);

        $this->labels->freeze($version, $this->rollup->rollUp($ingredientIds, $effective), CarbonImmutable::now());
    }
}
