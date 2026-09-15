<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/recipes/{recipe}/versions/{version} — the whole
 * version: header, lines, packaging, outputs, steps and the frozen allergen
 * label.
 *
 * Everything in one response because a recipe editor needs all of it to render
 * anything, and four requests to open one screen is four chances for a partial
 * view of a formulation.
 *
 * `ETag: "<lock_version>"` is the version's own validator — the one the line,
 * output and step replacements require as `If-Match`.
 *
 * **No cost fields on the lines.** The projection is K1.3, behind
 * `recipe.view_costs_organisation`.
 */
final class RecipeVersionShowController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $lines = RecipeVersionLine::query()->where('recipe_version_id', $record->getKey())->orderBy('line_number')->get();
        $outputs = RecipeVersionOutput::query()->where('recipe_version_id', $record->getKey())->orderByDesc('is_primary')->orderBy('id')->get();
        $steps = RecipeVersionStep::query()->where('recipe_version_id', $record->getKey())->orderBy('step_number')->get();
        $packaging = RecipeVersionPackaging::query()->where('recipe_version_id', $record->getKey())->orderBy('line_number')->get();
        $allergens = RecipeVersionAllergen::query()->where('recipe_version_id', $record->getKey())->orderBy('allergen_code')->get();

        return ApiResponse::data([
            'version' => $this->presenter->version($record),
            'lines' => $lines->map(fn (RecipeVersionLine $line): array => $this->presenter->line($line))->all(),
            'packaging' => $packaging->map(fn (RecipeVersionPackaging $row): array => $this->presenter->packaging($row))->all(),
            'outputs' => $outputs->map(fn (RecipeVersionOutput $output): array => $this->presenter->output($output))->all(),
            'steps' => $steps->map(fn (RecipeVersionStep $step): array => $this->presenter->step($step))->all(),
            'allergens' => $allergens->map(fn (RecipeVersionAllergen $row): array => $this->presenter->allergen($row))->all(),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
