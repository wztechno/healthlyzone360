<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\PurchaseOrderPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * GET /catalogue/procurement/purchase-orders — the order book (§6).
 *
 * Newest first and cursor-paginated over the platform's own `(created_at, id)`
 * keyset, exactly as the purchases ledger is: an order book is written to while
 * somebody is walking it, and `LIMIT/OFFSET` silently skips and repeats rows
 * when that happens.
 *
 * ## Three filters, and one of them is not a filter
 *
 * `status` and `supplier_id` narrow the book the way a person asks about it —
 * "what is still out with the wholesaler". `ids[]` is different: it is a **batch
 * read**, the shape slice 7's print preview needs when somebody issues four
 * orders and prints them as one document. Fetching four orders as four requests
 * would be four round trips for one sheet of paper, and the cap of fifty is what
 * a browser can plausibly be asked to lay out at once.
 *
 * Rows come back with their lines loaded, because this presenter serves one
 * shape and the print read wants all of it. The page limit is the platform
 * default of twenty-five, so a page is at most twenty-five orders' worth of
 * lines rather than an unbounded join.
 *
 * Requires `inventory.order_supplies_organisation` — the **read** is gated too
 * (§5). This is not a list of shelves; it is the record of who this kitchen buys
 * from, how much of what, and how often.
 */
final class PurchaseOrderIndexController
{
    /** The most orders one print batch may name. */
    private const int MAX_IDS = 50;

    public function __construct(private readonly PurchaseOrderPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'status' => ['nullable', Rule::enum(PurchaseOrderStatus::class)],
            'supplier_id' => [
                'nullable',
                'uuid',
                Rule::exists('suppliers', 'id')->where('organisation_id', $organisationId),
            ],
            'ids' => ['nullable', 'array', 'max:'.self::MAX_IDS],
            'ids.*' => ['uuid'],
        ]);

        $query = PurchaseOrder::query()->with(['supplier', 'branch', 'lines']);

        if (isset($validated['status'])) {
            $query->where('status', $validated['status']);
        }

        if (isset($validated['supplier_id'])) {
            $query->where('supplier_id', $validated['supplier_id']);
        }

        if (isset($validated['ids'])) {
            // Cross-organisation identifiers simply do not match — the tenant
            // scope is already on the query, so a batch naming another kitchen's
            // order returns fewer rows rather than leaking that it exists.
            $query->whereKey(array_values(array_map(strval(...), $validated['ids'])));
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: true);

        /** @var Builder<PurchaseOrder> $query */
        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            [
                'purchase_orders' => $page['items']
                    ->map(fn (PurchaseOrder $order): array => $this->presenter->purchaseOrder($order))
                    ->all(),
            ],
            $page['meta'],
        );
    }
}
