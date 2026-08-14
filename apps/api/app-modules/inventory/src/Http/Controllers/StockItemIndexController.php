<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/inventory/items — every shelf this kitchen has, and which book
 * it belongs in.
 *
 * Stock items are derived (INV2.0), so this list is now long: one row per
 * ingredient in the library plus one per bought-in product. Two things make that
 * usable rather than overwhelming, and both belong here rather than in each
 * client that renders a picker.
 *
 * **`backing` sorts the two books.** `product` when the shelf is something the
 * kitchen buys in to resell, `ingredient` when it is something it cooks with.
 * The stock screen shows them as two tables; the field is what tells them apart
 * without the client having to reason about which foreign key is null.
 *
 * **The order is the ranking.** A goods-receipt picker over two hundred
 * ingredients is unusable alphabetically, so shelves that hold something come
 * first, then shelves that have ever moved, then the rest by name. A client that
 * preserves the order it is given gets a picker whose first entries are the ones
 * a kitchen actually receives, and the type-ahead handles the tail. `is_stocked`
 * and `has_history` are published too, so a client can mark the difference rather
 * than relying on position alone.
 *
 * Both flags are correlated subqueries rather than joins: a join to `stock_levels`
 * multiplies a row by its branches, and this list is per organisation, not per
 * branch — "does anything, anywhere, hold this" is the question a picker asks.
 */
final class StockItemIndexController
{
    public function __invoke(): JsonResponse
    {
        $items = StockItem::query()
            ->select('stock_items.*')
            ->selectRaw('exists (select 1 from stock_levels sl where sl.stock_item_id = stock_items.id and sl.quantity <> 0) as is_stocked')
            ->selectRaw('exists (select 1 from stock_movements sm where sm.stock_item_id = stock_items.id) as has_history')
            ->orderByRaw('is_stocked desc, has_history desc, name_en asc')
            ->get()
            ->map(fn (StockItem $item): array => [
                'id' => (string) $item->getKey(),
                'code' => $item->code,
                'name_en' => $item->name_en,
                'unit_code' => $item->unit_code,
                'ingredient_id' => $item->ingredient_id,
                'catalogue_item_id' => $item->catalogue_item_id,
                'backing' => $item->catalogue_item_id === null ? 'ingredient' : 'product',
                'is_stocked' => (bool) $item->getAttribute('is_stocked'),
                'has_history' => (bool) $item->getAttribute('has_history'),
            ]);

        return ApiResponse::data(['stock_items' => $items]);
    }
}
