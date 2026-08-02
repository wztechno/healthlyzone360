<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/recipes/{recipe}/versions — the version history.
 *
 * Unpaginated on purpose: the collection is bounded by how many times one
 * kitchen has revised one formulation, and a cursor over a dozen rows would
 * add a walk to every client for no benefit.
 */
final class RecipeVersionIndexController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe): JsonResponse
    {
        $record = $this->locator->recipe($recipe);

        $versions = RecipeVersion::query()
            ->where('recipe_id', $record->getKey())
            ->orderBy('version_number')
            ->get();

        return ApiResponse::data(
            $versions->map(fn (RecipeVersion $version): array => $this->presenter->version($version))->all(),
            ['count' => $versions->count()],
        );
    }
}
