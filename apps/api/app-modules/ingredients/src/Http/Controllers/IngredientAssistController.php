<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Assistant\IngredientAssistService;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/ingredients/assist — what the new-ingredient form
 * should suggest for a typed English name.
 *
 * A POST because it spends a model call, not because it writes: nothing here
 * touches a row. Always 200 with whatever parts worked; `unavailable` names
 * the parts that did not.
 */
final class IngredientAssistController
{
    public function __invoke(Request $request, IngredientAssistService $assistant): JsonResponse
    {
        $validated = $request->validate(['name_en' => ['required', 'string', 'min:2', 'max:150']]);

        return ApiResponse::data($assistant->assist(trim($validated['name_en'])));
    }
}
