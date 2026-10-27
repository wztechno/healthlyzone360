<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Services\RecipeSpreadsheetService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Http\Requests\ImportSpreadsheetRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * POST /api/v1/catalogue/recipes/imports — a workbook of recipes, one row per formulation line.
 *
 * Every recipe is its own transaction and the answer is the per-row report: one recipe that
 * fails does not stop the others. The rules are {@see RecipeSpreadsheetService}'s.
 */
final class RecipeImportController
{
    public function __construct(
        private readonly RecipeSpreadsheetService $spreadsheet,
    ) {}

    /**
     * @throws ValidationException when the file itself cannot be read
     */
    public function __invoke(ImportSpreadsheetRequest $request): JsonResponse
    {
        return ApiResponse::data($this->spreadsheet->import($request->spreadsheet()->getPathname())->toArray());
    }
}
