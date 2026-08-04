<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class GoodsReceiptStoreController
{
    public function __invoke(Request $request, GoodsReceiptService $receipts, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'purchase_order_id' => ['nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.stock_item_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'min:0.0001'],
        ]);

        $receipt = $receipts->post(
            $context->organisationId(),
            $validated['branch_id'],
            $validated['purchase_order_id'] ?? null,
            $validated['lines'],
        );

        return ApiResponse::data(['goods_receipt' => ['id' => (string) $receipt->getKey()]], status: 201);
    }
}
