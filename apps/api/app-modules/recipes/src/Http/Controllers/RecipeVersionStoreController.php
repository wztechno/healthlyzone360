<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Requests\StoreRecipeVersionRequest;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/recipes/{recipe}/versions — open a new draft.
 *
 * This is how a published version is "edited": it is not. A published version
 * is frozen, and the supported change is a new draft, optionally copied from
 * an existing one. No `If-Match` — nothing existing is being written.
 */
final class RecipeVersionStoreController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionService $versions,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreRecipeVersionRequest $request, string $recipe): JsonResponse
    {
        $record = $this->locator->recipe($recipe);
        $copyFrom = $request->copyFromVersion();

        $version = $this->versions->newDraft(
            $record,
            $copyFrom === null ? null : $this->locator->version($record, (string) $copyFrom),
        );

        return ApiResponse::data(['version' => $this->presenter->version($version)], status: 201)
            ->withHeaders(['ETag' => '"'.$version->lock_version.'"']);
    }
}
