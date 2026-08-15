<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class StockAdjustController
{
    public function __invoke(Request $request, InventoryService $inventory, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'stock_item_id' => ['required', 'uuid'],
            'quantity_delta' => ['required', 'numeric'],
            'notes' => ['nullable', 'string', 'max:255'],
        ]);

        $movement = $inventory->recordMovement(
            $context->organisationId(),
            $validated['branch_id'],
            $validated['stock_item_id'],
            'adjust',
            (string) $validated['quantity_delta'],
            notes: $validated['notes'] ?? null,
        );

        return ApiResponse::data(['movement' => [
            'id' => (string) $movement->getKey(),
            'quantity_delta' => (string) $movement->quantity_delta,
            'reason' => $movement->reason,
        ]], status: 201);
    }
}
