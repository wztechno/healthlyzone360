<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
 *
 * `?supplier_lot=` answers the recall question — which deliveries brought lot X
 * (ingredient barcodes, plan §7). An exact match: a lot is an identifier, and a
 * near miss on a recall is a wrong answer.
 */
final class GoodsReceiptIndexController
{
    public function __construct(private readonly GoodsReceiptPresenter $presenter) {}

    public function __invoke(Request $request): JsonResponse
    {
        $showCosts = Gate::allows('inventory.view_costs_organisation');
        $lot = $request->query('supplier_lot');

        $receipts = GoodsReceipt::query()
            ->with(['lines', 'supplier'])
            ->when(is_string($lot) && $lot !== '', fn (Builder $query) => $query->whereHas(
                'lines',
                fn (Builder $lines) => $lines->where('supplier_lot', $lot),
            ))
            ->orderByDesc('received_at')
            ->limit(50)
            ->get()
            ->map(fn (GoodsReceipt $receipt): array => $this->presenter->receipt($receipt, $showCosts));

        return ApiResponse::data(['goods_receipts' => $receipts]);
    }
}
