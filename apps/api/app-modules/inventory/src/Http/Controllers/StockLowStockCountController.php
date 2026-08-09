<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/inventory/low-stock-count.
 *
 * How many levels are low right now (INV1.3) — a level with a threshold set
 * whose quantity has reached or fallen below it. Computed in the query, the
 * same rule {@see InventoryService::isLowStock()}
 * applies per row, so the hub badge and the stock screen never disagree.
 *
 * Scoped to the active branch when `X-Branch-Id` is set and to the whole
 * organisation otherwise — the same narrowing as the levels index — so a hub
 * KPI reads for the branch the manager is standing in, or org-wide when they
 * hold no branch. `whereColumn` keeps the comparison inside Postgres against the
 * two `decimal(14,4)` columns; a null threshold is excluded by
 * `whereNotNull`, matching "never low".
 *
 * Requires `inventory.view_organisation`.
 */
final class StockLowStockCountController
{
    public function __invoke(TenantContext $context): JsonResponse
    {
        $branchId = $context->branchId();

        $count = StockLevel::query()
            ->whereNotNull('reorder_threshold')
            ->whereColumn('quantity', '<=', 'reorder_threshold')
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->count();

        return ApiResponse::data(['count' => $count]);
    }
}
