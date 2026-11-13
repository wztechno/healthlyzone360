<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\StockCountSpreadsheetService;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Spreadsheet\SpreadsheetWriter;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * GET /api/v1/catalogue/inventory/levels/export — one branch's count sheet.
 * GET /api/v1/catalogue/inventory/counts/import-template — the empty template.
 *
 * The cost pair is printed only for a caller holding
 * `inventory.view_costs_organisation`, the same in-process `Gate::allows`
 * redaction the goods-receipts index draws: the sheet is still a count sheet
 * for someone who may not see money.
 */
final class StockLevelExportController
{
    public function __invoke(Request $request, StockCountSpreadsheetService $sheet, SpreadsheetWriter $writer, TenantContext $context): BinaryFileResponse
    {
        if ($request->route('template') === true) {
            return $writer->download('stock-count-import-template.xlsx', StockCountSpreadsheetService::HEADERS, $sheet->templateRows());
        }

        $branchId = $context->branchId();

        if ($branchId === null) {
            throw new ApiException(ErrorCode::ContextBranchRequired, details: ['required_headers' => ['X-Branch-Id']]);
        }

        $withCosts = Gate::allows('inventory.view_costs_organisation');

        return $writer->download(
            'stock-count-'.now()->format('Y-m-d').'.xlsx',
            $sheet->exportHeaders($withCosts),
            $sheet->exportRows($branchId, $withCosts),
        );
    }
}
