<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/recipes/{recipe}/archive.
 *
 * A lifecycle action as a POST sub-resource, never a `PATCH status` (master
 * plan v2 §4.15). Refused with `catalogue.in_use` while a published version
 * exists: withdrawing something from sale is retiring the version, and that
 * has its own route and its own permission.
 *
 * There is no delete. A recipe that has ever been published is part of a
 * food-safety record.
 */
final class RecipeArchiveController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeService $recipes,
        private readonly RecipeAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $recipe): JsonResponse
    {
        $record = $this->locator->recipe($recipe);
        $archived = $this->recipes->archive($record, $this->requiredLockVersion($request));

        return ApiResponse::data(['recipe' => $this->presenter->recipe($archived)])
            ->withHeaders(['ETag' => '"'.$archived->lock_version.'"']);
    }
}
