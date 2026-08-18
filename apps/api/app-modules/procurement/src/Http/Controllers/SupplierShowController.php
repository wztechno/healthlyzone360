<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Procurement\Services\LastPurchasePriceQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * GET /catalogue/procurement/suppliers/{supplierId} — one supplier, its named
 * contacts and what it sells this kitchen.
 *
 * Contacts and supplied items are embedded rather than left behind two more
 * endpoints, because unlike a delivery zone's map they are bounded sets a
 * person maintains by hand: a supplier has a handful of people and a page of
 * items, and the page that shows the record is the page that edits them.
 *
 * **Last purchase prices cost one query for the whole section** (SUP2). The
 * links are loaded with their stock items, their ids are collected, and
 * {@see LastPurchasePriceQuery::perSupplierItem()} answers all of them in one
 * `DISTINCT ON` — a supplier with sixty items is one statement, not sixty.
 *
 * The route takes `inventory.view_organisation`; the *money* inside
 * `supplied_items[].last_purchase` additionally takes
 * `inventory.view_costs_organisation`, and the presenter nulls the amount and
 * currency without it while leaving the date, quantity and unit alone. That is
 * the same split the goods-receipts index draws, and it is why `Hidden` and
 * `never bought here` stay two distinct states on the screen rather than
 * collapsing into one blank cell.
 *
 * An archived supplier is served normally. The archive is not a hiding place —
 * a receipt posted last month names this supplier, and the screen that explains
 * it needs the record. `archived_at` is what tells the client to render the
 * record read-only.
 */
final class SupplierShowController
{
    public function __construct(private readonly SupplierPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(
        string $supplierId,
        LastPurchasePriceQuery $lastPurchases,
        TenantContext $context,
    ): JsonResponse {
        $supplier = Supplier::query()
            ->with(['contacts', 'suppliedItems.stockItem'])
            ->whereKey($supplierId)
            ->first();

        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $stockItemIds = array_values($supplier->suppliedItems
            ->map(static fn (SupplierStockItem $link): string => (string) $link->stock_item_id)
            ->all());

        $prices = $lastPurchases->perSupplierItem(
            $context->organisationId(),
            (string) $supplier->getKey(),
            $stockItemIds,
        );

        return ApiResponse::data([
            'supplier' => $this->presenter->detail(
                $supplier,
                $prices,
                showCosts: Gate::allows('inventory.view_costs_organisation'),
            ),
        ]);
    }
}
