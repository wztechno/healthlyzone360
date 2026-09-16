<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Production\Services\ProductionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * Book a planned batch. There is no body: what the batch consumed and yielded is derived from its
 * recipe version and planned yield (see {@see ProductionService}), never typed.
 */
final class ProductionOrderCompleteController
{
    public function __invoke(string $productionOrder, ProductionService $production): JsonResponse
    {
        $order = ProductionOrder::query()->whereKey($productionOrder)->first();
        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        ['order' => $order, 'yield' => $yield] = $production->complete($order);

        return ApiResponse::data(['production_order' => [
            'id' => (string) $order->getKey(),
            'status' => $order->status,
            // Whether the batch arrived with a cost, and not the cost itself: booking a batch is
            // `inventory.manage_organisation`, what it cost is `inventory.view_costs_organisation`.
            'yield_valued' => $yield !== null && $yield->cost_amount !== null,
        ]]);
    }
}
