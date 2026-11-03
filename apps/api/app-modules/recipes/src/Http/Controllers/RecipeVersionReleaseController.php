<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/recipes/{recipe}/versions/{version}/release — accept
 * the recomputed allergen label of a quarantined version and put it, and the
 * listings selling it, back on sale.
 *
 * Beside publish and retire, under the same `recipe.publish_organisation`: it
 * puts a label in front of a diner. `confirmed: true` is the manager's tick
 * that they compared the old label with the new one; without it the release is
 * a 422, never a default.
 */
final class RecipeVersionReleaseController
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
    public function __invoke(Request $request, string $recipe, string $version): JsonResponse
    {
        $request->validate(['confirmed' => ['required', 'boolean', 'accepted']]);

        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $released = $this->versions->release($record, $this->requiredLockVersion($request));

        return ApiResponse::data(['version' => $this->presenter->version($released)])
            ->withHeaders(['ETag' => '"'.$released->lock_version.'"']);
    }
}
