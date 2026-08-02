<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Http\Requests\UpdateRecipeVersionRequest;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/recipes/{recipe}/versions/{version} — behind
 * `precondition`.
 *
 * A published or retired version is refused with
 * `409 catalogue.version_immutable`, not a conflict: reloading will never make
 * it writable, and the answer is a new draft version.
 */
final class RecipeVersionUpdateController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionService $versions,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateRecipeVersionRequest $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $updated = $this->versions->update($record, $request->validated(), $this->requiredLockVersion($request));

        return ApiResponse::data(['version' => $this->presenter->version($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
