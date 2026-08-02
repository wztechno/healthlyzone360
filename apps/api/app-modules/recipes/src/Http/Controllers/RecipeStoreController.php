<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Requests\StoreRecipeRequest;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/recipes.
 *
 * The response carries the recipe **and** the draft version 1 that was created
 * with it. A recipe with no versions is a name with nothing behind it, and
 * making the client fetch the version it just implicitly created would be a
 * round trip to learn something the server already knows.
 */
final class RecipeStoreController
{
    public function __construct(
        private readonly RecipeService $recipes,
        private readonly RecipeAdminPresenter $presenter,
        private readonly RecipeVersionPresenter $versions,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreRecipeRequest $request): JsonResponse
    {
        /** @var array{name_en: string, name_ar?: string|null, slug?: string|null, branch_id?: string|null, recipe_category?: string|null, source_kind?: string|null, confidentiality?: string|null, notes?: string|null} $attributes */
        $attributes = $request->validated();

        $created = $this->recipes->create($attributes);

        return ApiResponse::data([
            'recipe' => $this->presenter->recipe($created['recipe']),
            'version' => $this->versions->version($created['version']),
        ], status: 201)->withHeaders(['ETag' => '"'.$created['recipe']->lock_version.'"']);
    }
}
