<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class GoodsReceiptIndexController
{
    public function __invoke(): JsonResponse
    {
        $receipts = GoodsReceipt::query()
            ->with('lines')
            ->orderByDesc('received_at')
            ->limit(50)
            ->get()
            ->map(fn (GoodsReceipt $receipt): array => [
                'id' => (string) $receipt->getKey(),
                'branch_id' => $receipt->branch_id,
                'purchase_order_id' => $receipt->purchase_order_id,
                'received_at' => $receipt->received_at?->toIso8601String(),
                'lines' => $receipt->lines->map(fn (GoodsReceiptLine $line): array => [
                    'stock_item_id' => $line->stock_item_id,
                    'quantity' => (string) $line->quantity,
                ])->all(),
            ]);

        return ApiResponse::data(['goods_receipts' => $receipts]);
    }
}
