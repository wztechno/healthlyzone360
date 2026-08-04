<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class ProductionOrderIndexController
{
    public function __invoke(): JsonResponse
    {
        $orders = ProductionOrder::query()->orderByDesc('created_at')->limit(50)->get()->map(fn (ProductionOrder $o): array => [
            'id' => (string) $o->getKey(),
            'recipe_version_id' => $o->recipe_version_id,
            'status' => $o->status,
            'branch_id' => $o->branch_id,
        ]);

        return ApiResponse::data(['production_orders' => $orders]);
    }
}
