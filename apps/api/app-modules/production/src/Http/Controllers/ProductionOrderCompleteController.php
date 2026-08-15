<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Services\ProductionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ProductionOrderCompleteController
{
    public function __invoke(Request $request, string $productionOrder, ProductionService $production): JsonResponse
    {
        $order = ProductionOrder::query()->whereKey($productionOrder)->first();
        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'consumes' => ['array'],
            'consumes.*.stock_item_id' => ['required', 'uuid'],
            'consumes.*.quantity' => ['required', 'numeric'],
            'yields' => ['array'],
            'yields.*.stock_item_id' => ['required', 'uuid'],
            'yields.*.quantity' => ['required', 'numeric'],
        ]);

        $order = $production->complete(
            $order,
            $validated['consumes'] ?? [],
            $validated['yields'] ?? [],
        );

        return ApiResponse::data(['production_order' => ['id' => (string) $order->getKey(), 'status' => $order->status]]);
    }
}
