<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ProductionOrderStoreController
{
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'recipe_version_id' => ['required', 'uuid'],
            'planned_yield' => ['nullable', 'numeric'],
        ]);

        $order = ProductionOrder::query()->create([
            'organisation_id' => $context->organisationId(),
            'branch_id' => $validated['branch_id'],
            'recipe_version_id' => $validated['recipe_version_id'],
            'planned_yield' => $validated['planned_yield'] ?? null,
            'status' => 'planned',
        ]);

        return ApiResponse::data(['production_order' => ['id' => (string) $order->getKey(), 'status' => $order->status]], status: 201);
    }
}
