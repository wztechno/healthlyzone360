<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POST /catalogue/procurement/goods-receipts — record that stock arrived, what
 * it cost, and which order it settles.
 *
 * `inventory.manage_organisation` gates the write, deliberately not
 * `inventory.view_costs_organisation`: recording that a delivery landed is a
 * warehouse job, and a receiving clerk enters the prices off the delivery note
 * without necessarily being the person allowed to *read* the valuation those
 * prices feed. The cost the post writes is redacted from that same clerk's
 * reads unless they also hold the cost permission (`GoodsReceiptIndexController`,
 * the receipt detail, the purchases ledger). §5 states the model in as many
 * words: "a receiver may enter prices printed on the supplier document even if
 * historical costs remain redacted after submission". Ops controllers validate
 * inline — no form requests — matching the sibling ops controllers.
 *
 * ## What slice 5 adds, and why it is validated here rather than in the service
 *
 * `received_on`, the invoice reference and date, the header charges, the order
 * and per-line order-line pointers, and the two explicit confirmations
 * (over-receipt, close-short). Shape and ownership are checked here, because a
 * form with forty rows in it needs a `422` naming the row; the *relationships*
 * between them — does this order line belong to that order, is more arriving
 * than was ordered, does the invoice total add up — are checked in the service,
 * inside the transaction, where the order is locked and the arithmetic lives.
 *
 * `branch_id` is validated against the active organisation. It was a bare `uuid`
 * until this slice, which meant a hand-typed identifier from another kitchen
 * reached the service; it now matches every other branch parameter in this API.
 */
final class GoodsReceiptStoreController
{
    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, GoodsReceiptService $receipts, TenantContext $context): JsonResponse
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
            'document_ref' => ['nullable', 'string', 'max:120'],
            // A different document from `document_ref`: the delivery note comes
            // with the driver, the invoice often comes days later.
            'supplier_invoice_ref' => ['nullable', 'string', 'max:120'],
            'invoice_date' => ['nullable', 'date'],
            // The branch-local business day. Left out, the service reads today
            // in the receiving branch's own timezone; a future date is refused
            // there, where the branch is known.
            'received_on' => ['nullable', 'date'],
            'variance_note' => ['nullable', 'string', 'max:255'],
            'purchase_order_id' => [
                'nullable',
                'uuid',
                Rule::exists('purchase_orders', 'id')->where('organisation_id', $organisationId),
            ],
            // Amounts are non-negative magnitudes; a discount reduces the
            // invoice through the arithmetic rather than through a sign.
            'discount_amount' => ['nullable', 'numeric', 'min:0'],
            'tax_amount' => ['nullable', 'numeric', 'min:0'],
            'delivery_amount' => ['nullable', 'numeric', 'min:0'],
            'other_charges_amount' => ['nullable', 'numeric', 'min:0'],
            'invoice_total_amount' => ['nullable', 'numeric', 'min:0'],
            'over_receipt_confirmed' => ['nullable', 'boolean'],
            'close_short' => ['nullable', 'boolean'],
            'close_short_reason' => ['nullable', 'string', 'max:255'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.stock_item_id' => [
                'required',
                'uuid',
                Rule::exists('stock_items', 'id')->where('organisation_id', $organisationId),
            ],
            // Existence only — that it belongs to *this* order is the service's
            // question, and answering it here would need a second lookup of the
            // order the service is about to lock anyway.
            'lines.*.purchase_order_line_id' => ['nullable', 'uuid', Rule::exists('purchase_order_lines', 'id')],
            'lines.*.quantity' => ['required', 'numeric', 'min:0.0001'],
            // The unit the price is quoted per. Optional: when omitted the price
            // is taken as per the stock item's own unit, which is how a kitchen
            // reads a delivery note ("flour, 25 kg at 2.00/kg"). The client knows
            // the item's unit code, not its unit id, so it sends none and the
            // service resolves the item's unit.
            'lines.*.unit_id' => [
                'nullable',
                'uuid',
                Rule::exists('measurement_units', 'id'),
            ],
            'lines.*.unit_price_amount' => ['nullable', 'numeric', 'min:0'],
            'lines.*.cost_currency_code' => [
                'nullable',
                'required_with:lines.*.unit_price_amount',
                'string',
                'size:3',
                Rule::exists('currencies', 'code'),
            ],
        ]);

        $receipt = $receipts->post(
            $organisationId,
            $validated['branch_id'],
            $validated['supplier_id'] ?? null,
            $validated['document_ref'] ?? null,
            $validated['purchase_order_id'] ?? null,
            $validated['lines'],
            receivedOn: $validated['received_on'] ?? null,
            supplierInvoiceRef: $validated['supplier_invoice_ref'] ?? null,
            invoiceDate: $validated['invoice_date'] ?? null,
            charges: array_intersect_key($validated, array_flip([
                'discount_amount',
                'tax_amount',
                'delivery_amount',
                'other_charges_amount',
                'invoice_total_amount',
            ])),
            varianceNote: $validated['variance_note'] ?? null,
            overReceiptConfirmed: (bool) ($validated['over_receipt_confirmed'] ?? false),
            closeShort: (bool) ($validated['close_short'] ?? false),
            closeShortReason: $validated['close_short_reason'] ?? null,
        );

        return ApiResponse::data([
            'goods_receipt' => [
                'id' => (string) $receipt->getKey(),
                // The two facts a client acts on straight away: which day this
                // delivery was filed under, and whether its paperwork is done.
                'received_on' => $receipt->received_on?->toDateString(),
                'cost_status' => $receipt->cost_status,
            ],
        ], status: 201);
    }
}
