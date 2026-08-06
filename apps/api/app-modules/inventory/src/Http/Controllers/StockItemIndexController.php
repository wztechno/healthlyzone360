<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class StockItemIndexController
{
    public function __invoke(): JsonResponse
    {
        $items = StockItem::query()->orderBy('code')->get()->map(fn (StockItem $item): array => [
            'id' => (string) $item->getKey(),
            'code' => $item->code,
            'name_en' => $item->name_en,
            'unit_code' => $item->unit_code,
            'ingredient_id' => $item->ingredient_id,
        ]);

        return ApiResponse::data(['stock_items' => $items]);
    }
}
