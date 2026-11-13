<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\StockCountSpreadsheetService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Http\Requests\ImportSpreadsheetRequest;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/inventory/counts/imports.
 *
 * A counted sheet back in, as stock counts and reorder points for one branch
 * ({@see StockCountSpreadsheetService::import()}). A count is a fact about one
 * shelf, so the branch is required, never defaulted to "every branch": an
 * organisation-wide member of a multi-branch kitchen must say which one.
 */
final class StockCountImportController
{
    public function __invoke(ImportSpreadsheetRequest $request, StockCountSpreadsheetService $sheet, TenantContext $context): JsonResponse
    {
        $branchId = $context->branchId();

        if ($branchId === null) {
            throw new ApiException(ErrorCode::ContextBranchRequired, details: ['required_headers' => ['X-Branch-Id']]);
        }

        return ApiResponse::data($sheet->import($request->spreadsheet()->getPathname(), $branchId)->toArray());
    }
}
