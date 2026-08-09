<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

final class StockLevelIndexController
{
    public function __invoke(TenantContext $context): JsonResponse
    {
        $branchId = $context->branchId();
        $levels = StockLevel::query()
            ->with('stockItem')
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->orderBy('stock_item_id')
            ->get()
            ->map(function (StockLevel $level): array {
                $threshold = $level->reorder_threshold === null ? null : (string) $level->reorder_threshold;

                return [
                    'id' => (string) $level->getKey(),
                    'branch_id' => $level->branch_id,
                    'stock_item_id' => $level->stock_item_id,
                    'quantity' => (string) $level->quantity,
                    'reorder_threshold' => $threshold,
                    'par_level' => $level->par_level === null ? null : (string) $level->par_level,
                    // Computed on read, never stored — the same live flag pattern
                    // as out-of-stock (INV1.3). Null threshold reads as never low.
                    'is_low' => InventoryService::isLowStock($threshold, (string) $level->quantity),
                    'item_code' => $level->stockItem?->code,
                    'item_name_en' => $level->stockItem?->name_en,
                    'ingredient_id' => $level->stockItem?->ingredient_id,
                ];
            });

        return ApiResponse::data(['levels' => $levels]);
    }
}
