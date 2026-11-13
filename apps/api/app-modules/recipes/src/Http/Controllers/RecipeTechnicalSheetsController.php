<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\CostVisibility;
use Healthy360\Recipes\Services\RecipeSummaries;
use Healthy360\Recipes\Services\RecipeVersionReads;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/recipes/technical-sheets?ids[]=… — up to twenty recipes at once, for
 * printing a stack of sheets without twenty round trips.
 *
 * Each entry is what the single reads answer: `recipe` and `versions` as
 * {@see RecipeShowController}, `current` as {@see RecipeVersionShowController} for the current
 * version (its lines also carry the ingredient's names, since a printed sheet has no catalogue
 * beside it), and `sheet` as {@see RecipeTechnicalSheetController} — or null for a reader without
 * `recipe.view_costs_organisation`, which this route does not require. Each costed sheet records
 * its own `catalogue.technical_sheet_viewed`, exactly as one read of it would.
 *
 * An id this kitchen cannot see is absent from the answer, never an error: the batch is a
 * convenience over the single reads, and those answer 404 one at a time.
 */
final class RecipeTechnicalSheetsController
{
    public function __construct(
        private readonly RecipeSummaries $summaries,
        private readonly RecipeVersionPresenter $versions,
        private readonly RecipeVersionReads $reads,
        private readonly CostVisibility $costVisibility,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{ids: list<string>} $validated */
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:20'],
            'ids.*' => ['required', 'string', 'uuid'],
        ]);

        $ids = array_values(array_unique($validated['ids']));

        $found = Recipe::query()->whereIn('id', $ids)->with('updater.profile')->get()->keyBy('id');

        /** @var EloquentCollection<int, Recipe> $recipes in the order asked for */
        $recipes = new EloquentCollection(array_values(array_filter(array_map(
            static fn (string $id): ?Recipe => $found->get($id),
            $ids,
        ))));

        $recipeIds = array_values(array_map(static fn (Recipe $recipe): string => (string) $recipe->getKey(), $recipes->all()));
        $rows = $this->summaries->page($recipes, $this->summaries->sellersVisible());
        $current = $this->summaries->currentVersions($recipeIds);
        $versionsByRecipe = RecipeVersion::query()->whereIn('recipe_id', $recipeIds)->orderBy('version_number')->get()->groupBy('recipe_id');
        $withCosts = $this->costVisibility->granted();

        $sheets = [];

        foreach ($recipeIds as $index => $recipeId) {
            $version = $current[$recipeId] ?? null;

            $sheets[] = [
                'recipe' => $rows[$index],
                'versions' => array_values(array_map(
                    fn (RecipeVersion $row): array => $this->versions->version($row),
                    ($versionsByRecipe[$recipeId] ?? collect())->all(),
                )),
                'current' => $version === null ? null : $this->reads->show($version, withIngredientNames: true),
                'sheet' => $version === null || ! $withCosts ? null : $this->reads->technicalSheet($version),
            ];
        }

        return ApiResponse::data(['sheets' => $sheets]);
    }
}
