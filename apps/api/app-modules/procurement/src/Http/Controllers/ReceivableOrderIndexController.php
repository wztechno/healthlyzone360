<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Services\ReceivedQuantityQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * GET /catalogue/procurement/receivable-orders — what a van could be carrying
 * today (§6).
 *
 * Every issued or partially received order for one branch, with each line's
 * ordered, received and outstanding quantity, so that the receive screen can
 * prefill a delivery with what is **still to come** rather than what was
 * originally asked for (§4).
 *
 * ## It sits on `inventory.manage_organisation`, not the ordering code
 *
 * That looks like a hole in §5's gate on the order book and it is the opposite:
 * §5 grants it in as many words — "the receiving endpoint may expose an issued
 * order's supplier, outstanding items and quantities to a receiver holding
 * `inventory.manage_organisation` without granting the full supply-order book".
 * The person unloading the van is rarely the person who decided to order it, and
 * making a receiver hold the chequebook to book in a delivery would be a control
 * that had made itself unusable.
 *
 * So this is a **deliberate manage-scoped subset**, and its shape is drawn to
 * match: an order number, a supplier, an issue date and the outstanding lines.
 * No notes, no recipient snapshot, no creation history, and — as everywhere on a
 * purchase order — no money at any depth. The order book itself, with everything
 * else on it, stays behind `inventory.order_supplies_organisation`.
 *
 * `branch_id` is a required query parameter rather than the `X-Branch-Id`
 * header, for the reason the proposal endpoints give: a manager holding an
 * organisation-wide membership has no header branch at all, and receiving is
 * always *at one site*.
 *
 * One query for the orders, one for their lines' received quantities. A kitchen
 * with a dozen orders out must not cost a dozen round trips.
 */
final class ReceivableOrderIndexController
{
    /** Orders one receive screen offers to pick from. Beyond this a kitchen has a backlog, not a picker. */
    private const int MAX_ORDERS = 50;

    public function __construct(private readonly ReceivedQuantityQuery $received) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'branch_id' => [
                'required',
                'uuid',
                Rule::exists('organisation_branches', 'id')->where('organisation_id', $organisationId),
            ],
            'supplier_id' => [
                'nullable',
                'uuid',
                Rule::exists('suppliers', 'id')->where('organisation_id', $organisationId),
            ],
        ]);

        $query = PurchaseOrder::query()
            ->with(['supplier', 'lines'])
            ->where('branch_id', $validated['branch_id'])
            ->whereIn('status', [PurchaseOrderStatus::Issued->value, PurchaseOrderStatus::PartiallyReceived->value])
            ->orderBy('issued_at')
            ->orderBy('id')
            ->limit(self::MAX_ORDERS);

        if (isset($validated['supplier_id'])) {
            $query->where('supplier_id', $validated['supplier_id']);
        }

        $orders = $query->get();

        $progress = $this->received->progressForOrders(
            array_values($orders->map(static fn (PurchaseOrder $order): string => (string) $order->getKey())->all()),
        );

        return ApiResponse::data([
            'receivable_orders' => $orders
                ->map(fn (PurchaseOrder $order): array => $this->order($order, $progress))
                ->all(),
        ]);
    }

    /**
     * @param  array<string, array{ordered: numeric-string, received: numeric-string, outstanding: numeric-string}>  $progress
     * @return array<string, mixed>
     */
    private function order(PurchaseOrder $order, array $progress): array
    {
        // Counted from the arithmetic rather than from the shaped rows below:
        // the number a picker sorts and labels by must come from the same place
        // the receive form's prefill does.
        $outstandingLineCount = 0;

        foreach ($order->lines as $orderLine) {
            $row = $progress[(string) $orderLine->getKey()] ?? null;

            if ($row === null || bccomp($row['outstanding'], '0', 4) > 0) {
                $outstandingLineCount++;
            }
        }

        $lines = $order->lines
            ->map(static function (PurchaseOrderLine $line) use ($progress): array {
                $row = $progress[(string) $line->getKey()] ?? null;

                return [
                    'purchase_order_line_id' => (string) $line->getKey(),
                    'stock_item_id' => (string) $line->stock_item_id,
                    'item_code' => $line->item_code,
                    'item_name_en' => $line->item_name_en,
                    'item_name_ar' => $line->item_name_ar,
                    'unit_code' => $line->unit_code,
                    'unit_id' => $line->unit_id,
                    'ordered_quantity' => (string) $line->quantity,
                    'received_quantity' => $row['received'] ?? '0.0000',
                    'outstanding_quantity' => $row['outstanding'] ?? (string) $line->quantity,
                ];
            })
            ->all();

        $supplier = $order->supplier;

        return [
            'id' => (string) $order->getKey(),
            'number' => $order->number,
            'status' => $order->status->value,
            'branch_id' => (string) $order->branch_id,
            'supplier' => ! $supplier instanceof Supplier ? null : [
                'id' => (string) $supplier->getKey(),
                'code' => $supplier->code,
                'name_en' => $supplier->name_en,
            ],
            'issued_at' => $order->issued_at?->toIso8601String(),
            'line_count' => count($lines),
            // Lines with nothing left to come are still listed, because a person
            // checking a delivery against a sheet needs to see that the row is
            // accounted for rather than missing. The count beside it is what the
            // picker sorts and labels by.
            'outstanding_line_count' => $outstandingLineCount,
            'lines' => $lines,
        ];
    }
}
