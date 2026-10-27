<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionReads;
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
        private readonly RecipeVersionReads $reads,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        return ApiResponse::data($this->reads->show($record))->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
