<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/inventory/counts.
 *
 * A stock count: the kitchen states what the shelf holds, and the ledger posts
 * the difference as an `adjust` ({@see InventoryService::recordCount()}). It is
 * how a shelf that comes up short is recorded now that no movement may take a
 * level below zero.
 */
final class StockCountController
{
    public function __invoke(Request $request, InventoryService $inventory, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'stock_item_id' => ['required', 'uuid'],
            'counted_quantity' => ['required', 'numeric', 'min:0'],
            'notes' => ['nullable', 'string', 'max:255'],
        ]);

        $movement = $inventory->recordCount(
            $context->organisationId(),
            $validated['branch_id'],
            $validated['stock_item_id'],
            (string) $validated['counted_quantity'],
            notes: $validated['notes'] ?? null,
        );

        return ApiResponse::data(['movement' => [
            'id' => (string) $movement->getKey(),
            'quantity_delta' => (string) $movement->quantity_delta,
            'reason' => $movement->reason,
        ]], status: 201);
    }
}
