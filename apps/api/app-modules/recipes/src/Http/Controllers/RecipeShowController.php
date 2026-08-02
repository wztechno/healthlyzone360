<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/recipes/{recipe}.
 *
 * Returns `ETag: "<lock_version>"` — the client's half of the
 * optimistic-concurrency contract: read the resource, keep the validator, send
 * it back as `If-Match` when writing.
 *
 * The version summaries come with it. Opening a recipe and immediately asking
 * "and which versions does it have" is one interaction, not two, and the list
 * is bounded by how many times a kitchen has revised one formulation.
 */
final class RecipeShowController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeAdminPresenter $presenter,
        private readonly RecipeVersionPresenter $versions,
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

        $published = $versions->firstWhere('status', RecipeVersionStatus::Published);

        return ApiResponse::data([
            'recipe' => $this->presenter->recipe($record, $published?->version_number),
            'versions' => $versions->map(fn (RecipeVersion $version): array => $this->versions->version($version))->all(),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
