<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Procurement\Services\ReceivedQuantityQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * GET /catalogue/procurement/goods-receipts/{goodsReceipt} — one delivery,
 * whole, with the order it settled (§6).
 *
 * Behind `inventory.manage_organisation`, the same code that posted it: the
 * person who booked a delivery in has to be able to look at what they booked.
 * The **money** on it is behind `inventory.view_costs_organisation` and is
 * redacted inside the response rather than refused at the door — the same split
 * the goods-receipts index draws, and the reason is that a receiving clerk needs
 * to see the quantities, the delivery note and whether the paperwork is still
 * outstanding even when the prices are not theirs to read.
 *
 * `cost_status`, the unpriced counts and `valuation_pending_fx` are **not**
 * redacted, deliberately. They say whether this receipt still needs somebody's
 * attention; they do not say what anything cost.
 *
 * The purchase-order block is §5's manage-scoped subset — number, status and the
 * per-line ordered/received/outstanding arithmetic — which is what somebody
 * standing over a pallet with a delivery note actually compares against. There
 * is no money on a purchase order at any depth, so nothing there needs a gate.
 *
 * A string parameter and an explicit lookup rather than route-model binding,
 * matching every other ops endpoint: an identifier from another kitchen is a
 * `404` produced by the tenant scope on the query.
 */
final class GoodsReceiptShowController
{
    public function __construct(
        private readonly GoodsReceiptPresenter $presenter,
        private readonly ReceivedQuantityQuery $received,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $goodsReceipt): JsonResponse
    {
        $receipt = GoodsReceipt::query()
            ->with(['lines', 'supplier'])
            ->whereKey($goodsReceipt)
            ->first();

        if ($receipt === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $order = $receipt->purchase_order_id === null
            ? null
            : PurchaseOrder::query()->with('lines')->whereKey($receipt->purchase_order_id)->first();

        $progress = $order === null
            ? []
            : $this->received->progressForOrders([(string) $order->getKey()]);

        return ApiResponse::data([
            'goods_receipt' => $this->presenter->detail(
                $receipt,
                Gate::allows('inventory.view_costs_organisation'),
                $order,
                $progress,
            ),
        ]);
    }
}
