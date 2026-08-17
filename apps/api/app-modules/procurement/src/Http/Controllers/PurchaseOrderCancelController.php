<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\PurchaseOrderPresenter;
use Healthy360\Procurement\Services\PurchaseOrderService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /catalogue/procurement/purchase-orders/{purchaseOrder}/cancel.
 *
 * **Nothing is deleted** (§3.5). The order, its lines and — if it was issued —
 * its recipient snapshot all stay exactly where they are, and `issued_at` is
 * left in place: cancelling does not un-issue, and a reprint of a cancelled
 * order should still say when it went out. What changes is the status and one
 * new stamp.
 *
 * Reachable from `draft` and `issued` and from nowhere else. An order with
 * deliveries against it cannot be cancelled as though nothing happened, which is
 * why the enum refuses it from `partially_received` onward; a refusal answers
 * `409` with `details.reason = purchase_order_not_cancellable`.
 *
 * Requires `inventory.order_supplies_organisation`.
 */
final class PurchaseOrderCancelController
{
    public function __construct(private readonly PurchaseOrderPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $purchaseOrder, PurchaseOrderService $orders): JsonResponse
    {
        $order = PurchaseOrder::query()->whereKey($purchaseOrder)->first();

        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $orders->cancel($order);

        $fresh = PurchaseOrder::query()
            ->with(['supplier', 'branch', 'lines'])
            ->whereKey($purchaseOrder)
            ->firstOrFail();

        return ApiResponse::data(['purchase_order' => $this->presenter->purchaseOrder($fresh)]);
    }
}
