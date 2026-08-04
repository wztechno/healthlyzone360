<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class StockWasteController
{
    public function __invoke(Request $request, InventoryService $inventory, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'stock_item_id' => ['required', 'uuid'],
            'quantity' => ['required', 'numeric', 'min:0.0001'],
            'notes' => ['nullable', 'string', 'max:255'],
        ]);

        $movement = $inventory->recordMovement(
            $context->organisationId(),
            $validated['branch_id'],
            $validated['stock_item_id'],
            'waste',
            -abs((float) $validated['quantity']),
            notes: $validated['notes'] ?? null,
        );

        return ApiResponse::data(['movement' => [
            'id' => (string) $movement->getKey(),
            'quantity_delta' => (string) $movement->quantity_delta,
            'reason' => $movement->reason,
        ]], status: 201);
    }
}
