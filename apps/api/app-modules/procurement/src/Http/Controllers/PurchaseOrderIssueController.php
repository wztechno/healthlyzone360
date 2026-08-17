<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\PurchaseOrderPresenter;
use Healthy360\Procurement\Services\PurchaseOrderService;
use Healthy360\Procurement\Services\ReceivedQuantityQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /catalogue/procurement/purchase-orders/{purchaseOrder}/issue.
 *
 * **Issue, not send.** §2's third correction, and the endpoint's name carries
 * it: phase 1 dispatches nothing through any channel — a person presses this,
 * the lines freeze, and they print the sheet and hand it over. There is
 * deliberately no `send` endpoint and no `sent_at` column, because a later
 * dispatch phase must have somewhere honest to record the real event.
 *
 * An action rather than a writable status field, so freezing an order is one
 * deliberate request with its own audit event rather than something a form save
 * can do by accident — the same shape supplier archive/restore take.
 *
 * Two refusals, both `409` with an explicit `details.reason`: a non-draft order
 * (`purchase_order_not_draft`) and an archived supplier (`supplier_archived`).
 * The second is §3.1's rule at the moment it matters — the supplier was live
 * when the draft was made and has been archived since, which is exactly when a
 * kitchen should be stopped rather than allowed to post an order to a shuttered
 * warehouse.
 *
 * Requires `inventory.order_supplies_organisation`.
 */
final class PurchaseOrderIssueController
{
    public function __construct(
        private readonly PurchaseOrderPresenter $presenter,
        private readonly ReceivedQuantityQuery $received,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $purchaseOrder, PurchaseOrderService $orders): JsonResponse
    {
        $order = PurchaseOrder::query()->whereKey($purchaseOrder)->first();

        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $orders->issue($order);

        $fresh = PurchaseOrder::query()
            ->with(['supplier', 'branch', 'lines', 'goodsReceipts.lines'])
            ->whereKey($purchaseOrder)
            ->firstOrFail();

        return ApiResponse::data([
            'purchase_order' => $this->presenter->purchaseOrder(
                $fresh,
                $this->received->progressForOrders([(string) $fresh->getKey()]),
            ),
        ]);
    }
}
