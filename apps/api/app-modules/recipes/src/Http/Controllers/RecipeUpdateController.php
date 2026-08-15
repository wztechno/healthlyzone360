<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Http\Requests\UpdateRecipeRequest;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/recipes/{recipe} — behind `precondition`.
 */
final class RecipeUpdateController
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
    public function __invoke(UpdateRecipeRequest $request, string $recipe): JsonResponse
    {
        $record = $this->locator->recipe($recipe);
        $updated = $this->recipes->update($record, $request->validated(), $this->requiredLockVersion($request));

        return ApiResponse::data(['recipe' => $this->presenter->recipe($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
