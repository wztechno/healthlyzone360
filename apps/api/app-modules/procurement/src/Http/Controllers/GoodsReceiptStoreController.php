<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POST /catalogue/procurement/goods-receipts — record that stock arrived, and
 * what it cost.
 *
 * `inventory.manage_organisation` gates the write, deliberately not
 * `inventory.view_costs_organisation`: recording that a delivery landed is a
 * warehouse job, and a receiving clerk enters the prices off the delivery note
 * without necessarily being the person allowed to *read* the valuation those
 * prices feed. The cost the post writes is redacted from that same clerk's
 * reads unless they also hold the cost permission (`GoodsReceiptIndexController`,
 * the purchases ledger). Ops controllers validate inline — no form requests —
 * matching the sibling ops controllers.
 */
final class GoodsReceiptStoreController
{
    public function __invoke(Request $request, GoodsReceiptService $receipts, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'branch_id' => ['required', 'uuid'],
            'supplier_id' => [
                'nullable',
                'uuid',
                Rule::exists('suppliers', 'id')->where('organisation_id', $organisationId),
            ],
            'document_ref' => ['nullable', 'string', 'max:120'],
            'purchase_order_id' => ['nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.stock_item_id' => [
                'required',
                'uuid',
                Rule::exists('stock_items', 'id')->where('organisation_id', $organisationId),
            ],
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
        );

        return ApiResponse::data(['goods_receipt' => ['id' => (string) $receipt->getKey()]], status: 201);
    }
}
