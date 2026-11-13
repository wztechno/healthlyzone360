<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\DuplicateStockShelves;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A person's two answers to a group on `/kitchen/stock-duplicates`.
 *
 * - `POST /catalogue/inventory/duplicates/merge` links an emptied shelf with
 *   history to the one that stays ({@see DuplicateStockShelves::mergeWithHistory()}).
 * - `POST /catalogue/inventory/duplicates/dismiss` keeps both, and the group
 *   leaves the list ({@see DuplicateStockShelves::dismiss()}).
 *
 * Both write stock rows, so both take `inventory.manage_organisation`.
 */
final class DuplicateStockResolveController
{
    public function __construct(private readonly DuplicateStockShelves $duplicates) {}

    public function merge(Request $request, TenantContext $context): Response
    {
        $validated = $request->validate([
            'keep_id' => ['required', 'uuid'],
            'drop_id' => ['required', 'uuid', 'different:keep_id'],
        ]);

        $this->duplicates->mergeWithHistory(
            (string) $context->organisationId(),
            $this->shelf($validated['keep_id']),
            $this->shelf($validated['drop_id']),
            (string) $request->user()?->getKey(),
        );

        return ApiResponse::noContent();
    }

    public function dismiss(Request $request, TenantContext $context): Response
    {
        $validated = $request->validate([
            'stock_item_ids' => ['required', 'array', 'min:2', 'max:50'],
            'stock_item_ids.*' => ['required', 'uuid', 'distinct'],
        ]);

        $this->duplicates->dismiss(
            (string) $context->organisationId(),
            array_values($validated['stock_item_ids']),
            (string) $request->user()?->getKey(),
        );

        return ApiResponse::noContent();
    }

    private function shelf(string $id): StockItem
    {
        return StockItem::query()->find($id) ?? throw new ApiException(ErrorCode::ResourceNotFound);
    }
}
