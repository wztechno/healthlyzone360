<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/ingredient-categories — the platform taxonomy plus
 * the kitchen's own, flat, with `parent_id` carrying the tree.
 *
 * Not cursor-paginated and not nested: the taxonomy is small (dozens of rows,
 * two levels), the client renders it as a tree in one pass, and paginating a
 * tree would hand it half a hierarchy.
 */
final class IngredientCategoryIndexController
{
    public function __construct(private readonly IngredientPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $categories = IngredientCategory::query()
            ->orderByRaw('parent_id nulls first')
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $categories->map(fn (IngredientCategory $category): array => $this->presenter->category($category))->all(),
            ['count' => $categories->count()],
        );
    }
}
