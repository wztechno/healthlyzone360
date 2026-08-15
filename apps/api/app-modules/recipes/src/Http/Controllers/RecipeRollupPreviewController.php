<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Requests\PreviewRecipeRollupRequest;
use Healthy360\Recipes\Services\CostVisibility;
use Healthy360\Recipes\Services\RecipeRollupPreviewService;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/recipes/roll-up-preview — figures for a draft
 * formulation without persisting it.
 *
 * Behind `recipe.view_organisation` or `recipe.manage_organisation`, because
 * the chef composing a version must be able to see what it would declare before
 * anybody publishes it. Estimated cost is omitted unless the caller also holds
 * `recipe.view_costs_organisation`.
 */
final class RecipeRollupPreviewController
{
    public function __construct(
        private readonly RecipeRollupPreviewService $preview,
        private readonly CostVisibility $costs,
    ) {}

    public function __invoke(PreviewRecipeRollupRequest $request): JsonResponse
    {
        $data = $this->preview->preview($request->draft(), $this->costs->granted());

        return ApiResponse::data($data);
    }
}
