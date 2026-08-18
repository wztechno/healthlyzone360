<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\PurchaseOrderPresenter;
use Healthy360\Procurement\Services\ReceivedQuantityQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/procurement/purchase-orders/{purchaseOrder} — one order, whole.
 *
 * The same shape the list serves, because there is one shape (see
 * {@see PurchaseOrderPresenter}). A string parameter and an explicit lookup
 * rather than route-model binding, matching every other ops endpoint here: an
 * identifier from another kitchen is a `404` produced by the tenant scope on the
 * query rather than a binding failure with a different body.
 *
 * Requires `inventory.order_supplies_organisation`.
 */
final class PurchaseOrderShowController
{
    public function __construct(
        private readonly PurchaseOrderPresenter $presenter,
        private readonly ReceivedQuantityQuery $received,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $purchaseOrder): JsonResponse
    {
        $order = PurchaseOrder::query()->with(['supplier', 'branch', 'lines', 'goodsReceipts.lines'])->whereKey($purchaseOrder)->first();

        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return ApiResponse::data([
            'purchase_order' => $this->presenter->purchaseOrder(
                $order,
                $this->received->progressForOrders([(string) $order->getKey()]),
            ),
        ]);
    }
}
