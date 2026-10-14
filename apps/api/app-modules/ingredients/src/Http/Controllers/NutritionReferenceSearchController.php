<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Nutrition\NutritionReferenceService;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class NutritionReferenceSearchController
{
    public function __invoke(Request $request, NutritionReferenceService $references): JsonResponse
    {
        $validated = $request->validate(['q' => ['required', 'string', 'min:2', 'max:150']]);
        $candidates = $references->search($validated['q']);

        return ApiResponse::data($candidates, ['count' => count($candidates)]);
    }
}
