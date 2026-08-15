<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Presenters\GoodsReceiptPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /catalogue/procurement/purchases-ledger — the browsable record behind the
 * monthly spend figure (INV1.1).
 *
 * Every goods-receipt line, newest first, flattened with the date, supplier and
 * item it belongs to: date, supplier, item, quantity, unit, unit price, line
 * total. Filterable by date range, supplier and ingredient — the three
 * questions a manager reconciling a month's spend actually asks.
 *
 * Behind `inventory.view_costs_organisation` at the route: this surface exists
 * to read the valuation, so someone without the cost permission gets a 403
 * rather than a redacted page (that redaction is the goods-receipts index's
 * job, for the clerk who posts but may not read costs). Cursor-paginated per
 * the platform norm over the line's own `(created_at, id)` — the immutable pair
 * `CursorPage` requires — while `received_at` is what the date-range filter and
 * the displayed date read, so a manager filters by when stock arrived and walks
 * by the stable append order.
 *
 * The presenter never reads a recipe line, a formulation quantity or a
 * derivation — a purchases ledger is a record of what was bought, and nothing
 * confidential about how it is used passes through it.
 */
final class PurchasesLedgerIndexController
{
    public function __construct(private readonly GoodsReceiptPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'supplier_id' => ['nullable', 'uuid'],
            'ingredient_id' => ['nullable', 'uuid'],
        ]);

        $query = GoodsReceiptLine::query()
            ->with(['goodsReceipt.supplier', 'stockItem'])
            ->whereHas('goodsReceipt', function ($receipt) use ($context, $validated): void {
                $receipt->where('organisation_id', $context->organisationId());

                if (isset($validated['supplier_id'])) {
                    $receipt->where('supplier_id', $validated['supplier_id']);
                }

                if (isset($validated['from'])) {
                    $receipt->where('received_at', '>=', $validated['from']);
                }

                if (isset($validated['to'])) {
                    $receipt->where('received_at', '<=', $validated['to']);
                }
            });

        if (isset($validated['ingredient_id'])) {
            $ingredientId = $validated['ingredient_id'];
            $query->whereHas('stockItem', function ($item) use ($ingredientId): void {
                $item->where('ingredient_id', $ingredientId);
            });
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            ['purchases' => $page['items']->map(fn (GoodsReceiptLine $line): array => $this->presenter->ledgerLine($line, showCosts: true))->all()],
            $page['meta'],
        );
    }
}
