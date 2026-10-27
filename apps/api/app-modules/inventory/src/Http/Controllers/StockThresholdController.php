<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PATCH /api/v1/catalogue/inventory/threshold.
 *
 * Sets — or clears — the reorder threshold (and optional par level) for one
 * (branch, stock item) pair (INV1.3). A `null` `reorder_threshold` clears it,
 * which the low-stock computation reads as *never low*; nothing here stores a
 * flag. The level row is created if the item has never moved at this branch, so
 * a manager can set a threshold before the first receipt — the same
 * `firstOrCreate` the movement path uses, minus the movement.
 *
 * A PATCH rather than the ops family's usual POST because this edits a property
 * of an existing level in place and is idempotent, where an adjustment or a
 * waste appends a new movement. Inline-validated in the ops style (no
 * form-request), gated by `inventory.manage_organisation`; the write and its
 * audit are {@see InventoryService::setThreshold()}, which the count-sheet
 * import shares.
 */
final class StockThresholdController
{
    public function __invoke(Request $request, InventoryService $inventory, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'stock_item_id' => ['required', 'uuid'],
            'reorder_threshold' => ['present', 'nullable', 'numeric', 'min:0'],
            'par_level' => ['sometimes', 'nullable', 'numeric', 'min:0'],
        ]);

        // The values arrive as `mixed` from validation; `is_numeric` narrows them
        // to the `numeric-string` the level's decimal columns hold (a cleared
        // threshold is null, which the low-stock computation reads as never low).
        $rawThreshold = $validated['reorder_threshold'];
        $rawParLevel = $validated['par_level'] ?? null;

        $level = $inventory->setThreshold(
            (string) $context->organisationId(),
            $validated['branch_id'],
            $validated['stock_item_id'],
            is_numeric($rawThreshold) ? (string) $rawThreshold : null,
            array_key_exists('par_level', $validated),
            is_numeric($rawParLevel) ? (string) $rawParLevel : null,
            $context->userId(),
        );

        $level->loadMissing('stockItem');

        return ApiResponse::data(['level' => [
            'id' => (string) $level->getKey(),
            'branch_id' => $level->branch_id,
            'stock_item_id' => $level->stock_item_id,
            'quantity' => (string) $level->quantity,
            'reorder_threshold' => $level->reorder_threshold === null ? null : (string) $level->reorder_threshold,
            'par_level' => $level->par_level === null ? null : (string) $level->par_level,
            'is_low' => InventoryService::isLowStock(
                $level->reorder_threshold === null ? null : (string) $level->reorder_threshold,
                (string) $level->quantity,
            ),
            'item_code' => $level->stockItem?->code,
            'item_name_en' => $level->stockItem?->name_en,
            'ingredient_id' => $level->stockItem?->ingredient_id,
        ]]);
    }
}
