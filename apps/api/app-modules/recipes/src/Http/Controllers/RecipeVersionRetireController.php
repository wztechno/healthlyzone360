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
 * POST /api/v1/catalogue/recipes/{recipe}/versions/{version}/retire — withdraw
 * a published version.
 *
 * Terminal, and deliberately so: a retired version is history, and history is
 * what makes an old allergen label reconstructable. Bringing a formulation
 * back means publishing a new version, which recomputes the label against the
 * mappings as they are now rather than as they were.
 */
final class RecipeVersionRetireController
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
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $retired = $this->versions->retire($record, $this->requiredLockVersion($request));

        return ApiResponse::data(['version' => $this->presenter->version($retired)])
            ->withHeaders(['ETag' => '"'.$retired->lock_version.'"']);
    }
}
