<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * GET /catalogue/procurement/goods-receipts — the most recent fifty receipts,
 * newest first, each with its lines.
 *
 * Behind `inventory.view_organisation`, but the *cost* on each line is behind
 * `inventory.view_costs_organisation` (INV1.1). A receiving clerk with the view
 * permission but not the cost one sees every quantity and unit and no price —
 * the presenter redacts the money and flags `costs_redacted`. The purchases
 * ledger is the surface for the person who may read the valuation.
 */
final class GoodsReceiptIndexController
{
    public function __construct(private readonly GoodsReceiptPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $showCosts = Gate::allows('inventory.view_costs_organisation');

        $receipts = GoodsReceipt::query()
            ->with(['lines', 'supplier'])
            ->orderByDesc('received_at')
            ->limit(50)
            ->get()
            ->map(fn (GoodsReceipt $receipt): array => $this->presenter->receipt($receipt, $showCosts));

        return ApiResponse::data(['goods_receipts' => $receipts]);
    }
}
