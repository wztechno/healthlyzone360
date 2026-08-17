<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Presenters\PurchaseOrderPresenter;
use Healthy360\Procurement\Services\PurchaseOrderService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * POST /catalogue/procurement/purchase-orders — one draft per supplier, in one
 * transaction (§6).
 *
 * The builder's commit. A person grouped a shortage list by supplier, confirmed
 * a preview, and this turns that preview into drafts — **all of them or none**.
 * Six of eight orders arriving with no way to tell which two are missing is the
 * outcome the single transaction exists to make impossible.
 *
 * ## Why `branch_id` sits on each order and is then required to be one branch
 *
 * The client's grouping model emits a branch per order because every proposal
 * row carries the branch it was read for, which is what makes a payload whose
 * branch disagrees with its lines unrepresentable. The server then insists they
 * all agree: §4 says a proposal is always **for one branch**, so a batch naming
 * two branches is two batches, and accepting it would create orders against a
 * site nobody was looking at.
 *
 * ## What the client may state, and what it may not
 *
 * A line is `{stock_item_id, quantity}` and nothing else. The item code, both
 * names, the unit and the supplier's own catalogue reference are all resolved
 * server-side (§6) — a client that could name a line could put anything at all
 * on a document a supplier reads. There is no price field here and there is none
 * coming: §3.5 puts actual prices on receipts.
 *
 * Quantities are validated as decimals with at most four places rather than
 * plain numerics, so `2.55555` earns a `422` naming the exact line instead of
 * being silently truncated by the column. The service re-checks with bcmath as a
 * backstop.
 *
 * Requires `inventory.order_supplies_organisation`.
 */
final class PurchaseOrderStoreController
{
    /** Suppliers in one batch. */
    private const int MAX_ORDERS = 20;

    /** Lines on one order. */
    private const int MAX_LINES = 200;

    /** Exclusive upper bound of `decimal(14,4)`. */
    private const string MAX_QUANTITY = '9999999999.9999';

    public function __construct(private readonly PurchaseOrderPresenter $presenter) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context, PurchaseOrderService $orders): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'orders' => ['required', 'array', 'min:1', 'max:'.self::MAX_ORDERS],
            'orders.*.supplier_id' => [
                'required',
                'uuid',
                Rule::exists('suppliers', 'id')->where('organisation_id', $organisationId),
            ],
            'orders.*.branch_id' => [
                'required',
                'uuid',
                Rule::exists('organisation_branches', 'id')->where('organisation_id', $organisationId),
            ],
            'orders.*.lines' => ['required', 'array', 'min:1', 'max:'.self::MAX_LINES],
            'orders.*.lines.*.stock_item_id' => [
                'required',
                'uuid',
                Rule::exists('stock_items', 'id')->where('organisation_id', $organisationId),
            ],
            'orders.*.lines.*.quantity' => [
                'required',
                'numeric',
                'decimal:0,4',
                'gt:0',
                'max:'.self::MAX_QUANTITY,
            ],
        ]);

        /** @var list<array{supplier_id: string, branch_id: string, lines: list<array{stock_item_id: string, quantity: string}>}> $requested */
        $requested = array_values($validated['orders']);

        $branchIds = array_unique(array_map(static fn (array $order): string => (string) $order['branch_id'], $requested));

        if (count($branchIds) !== 1) {
            // §4: a proposal is for one branch. Two branches in one batch is two
            // batches, and guessing which one the person meant is not this
            // endpoint's decision to make.
            throw ValidationException::withMessages([
                'orders' => ['Every order in one batch is for the same branch.'],
            ]);
        }

        $created = $orders->createBatch(
            $organisationId,
            (string) reset($branchIds),
            array_map(
                static fn (array $order): array => [
                    'supplier_id' => (string) $order['supplier_id'],
                    'lines' => array_map(
                        static fn (array $line): array => [
                            'stock_item_id' => (string) $line['stock_item_id'],
                            'quantity' => (string) $line['quantity'],
                        ],
                        $order['lines'],
                    ),
                ],
                $requested,
            ),
        );

        // Reloaded rather than presented from the write's own models: the create
        // answers the full shape, and the supplier, branch and lines relations
        // are what fill it. `whereIn` returns them in no particular order, so
        // the response is re-keyed back into request order below — the person
        // confirmed a list and the answer has to line up with it.
        $ids = array_map(static fn (PurchaseOrder $order): string => (string) $order->getKey(), $created);

        $loaded = PurchaseOrder::query()
            ->with(['supplier', 'branch', 'lines'])
            ->whereKey($ids)
            ->get()
            ->keyBy(static fn (PurchaseOrder $order): string => (string) $order->getKey());

        $shaped = [];

        foreach ($ids as $id) {
            $order = $loaded->get($id);

            if (! $order instanceof PurchaseOrder) {
                throw new ApiException(ErrorCode::ServerInternalError);
            }

            $shaped[] = $this->presenter->purchaseOrder($order);
        }

        return ApiResponse::data(['purchase_orders' => $shaped], ['count' => count($shaped)], status: 201);
    }
}
