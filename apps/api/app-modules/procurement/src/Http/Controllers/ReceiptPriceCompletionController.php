<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Procurement\Services\ReceiptPriceCompletionService;
use Healthy360\Procurement\Services\ReceivedQuantityQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POST /catalogue/procurement/goods-receipts/{goodsReceipt}/complete-prices —
 * the invoice that arrived a week after the van (§3.6, §6).
 *
 * Behind `inventory.view_costs_organisation`, and the boundary is worth stating
 * because it is not the obvious one. Entering a price **off the delivery note at
 * the door** is a warehouse job and takes `inventory.manage_organisation` (§5's
 * blind-write model — the receiver writes what the paper says and may not read
 * the valuation back). Going over the money **afterwards**, deciding what a line
 * cost when the paperwork disagrees or is late, is the cost holder's job. So the
 * post accepts prices under manage and this endpoint does not.
 *
 * The quantities are untouchable here: the request names lines and prices, and
 * nothing on it could change what arrived. §3.6 is explicit that posted
 * quantities are never edited in place.
 *
 * Answers with the receipt, so the queue screen can drop a row that has just
 * become complete without a second read.
 */
final class ReceiptPriceCompletionController
{
    public function __construct(
        private readonly GoodsReceiptPresenter $presenter,
        private readonly ReceivedQuantityQuery $received,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(
        string $goodsReceipt,
        Request $request,
        ReceiptPriceCompletionService $completion,
    ): JsonResponse {
        // The tenant scope on the model is the whole of the ownership check: a
        // receipt from another kitchen is not found, never forbidden.
        $receipt = GoodsReceipt::query()->whereKey($goodsReceipt)->first();

        if ($receipt === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.goods_receipt_line_id' => ['required', 'uuid'],
            'lines.*.unit_price_amount' => ['required', 'numeric', 'min:0'],
            // Optional, and checked rather than stored: the total and the price
            // are two views of one fact, and a database holding two answers for
            // it is worse than one that refuses.
            'lines.*.line_total_amount' => ['nullable', 'numeric', 'min:0'],
            'lines.*.cost_currency_code' => [
                'required',
                'string',
                'size:3',
                Rule::exists('currencies', 'code'),
            ],
        ]);

        $completion->complete($receipt, $validated['lines']);

        $fresh = GoodsReceipt::query()
            ->with(['lines', 'supplier'])
            ->whereKey($goodsReceipt)
            ->firstOrFail();

        $order = $fresh->purchase_order_id === null
            ? null
            : PurchaseOrder::query()->with('lines')->whereKey($fresh->purchase_order_id)->first();

        return ApiResponse::data([
            'goods_receipt' => $this->presenter->detail(
                $fresh,
                // Reaching this controller at all means the cost permission was
                // held, so there is nothing to redact from the answer.
                showCosts: true,
                order: $order,
                progress: $order === null
                    ? []
                    : $this->received->progressForOrders([(string) $order->getKey()]),
            ),
        ]);
    }
}
