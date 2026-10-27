<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Services\IngredientSpreadsheetService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Http\Requests\ImportSpreadsheetRequest;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/ingredients/imports — read an edited workbook back into the catalogue.
 *
 * A 200 once the file itself is readable: a sheet is many independent rows, and the body says row
 * by row what was created, updated, skipped or refused. A file that is not a workbook, or has no
 * Reference / Name (EN) header, is the 422.
 */
final class IngredientImportController
{
    public function __invoke(ImportSpreadsheetRequest $request, IngredientSpreadsheetService $service): JsonResponse
    {
        return ApiResponse::data($service->import((string) $request->spreadsheet()->getRealPath())->toArray());
    }
}
