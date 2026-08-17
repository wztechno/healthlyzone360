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
 * PATCH /catalogue/procurement/purchase-orders/{purchaseOrder} — edit a draft
 * (§6).
 *
 * Presence-keyed like every other partial write in this module: an omitted field
 * is left alone, `notes: null` clears the note. `lines` is a **full replace** —
 * the body states the whole desired set — because the alternative is a diff, and
 * a diff needs an identity for a line the client does not name.
 *
 * **Draft only.** An issued order answers `409` with
 * `details.reason = purchase_order_not_draft`, and that is the immutability
 * §3.5 requires rather than a permission problem: the supplier is holding a copy
 * of what was issued, and an order that could still change would make their copy
 * a fiction. The client hides the editing controls on a non-draft, so reaching
 * this refusal means the status changed under somebody — which is precisely the
 * race worth answering honestly.
 *
 * Requires `inventory.order_supplies_organisation`.
 */
final class PurchaseOrderUpdateController
{
    /** Lines on one order — the same cap the batch create applies. */
    private const int MAX_LINES = 200;

    /** Exclusive upper bound of `decimal(14,4)`. */
    private const string MAX_QUANTITY = '9999999999.9999';

    public function __construct(private readonly PurchaseOrderPresenter $presenter) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(
        Request $request,
        string $purchaseOrder,
        TenantContext $context,
        PurchaseOrderService $orders,
    ): JsonResponse {
        $organisationId = $context->organisationId();

        $order = PurchaseOrder::query()->whereKey($purchaseOrder)->first();

        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $validated = $request->validate([
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'lines' => ['sometimes', 'array', 'min:1', 'max:'.self::MAX_LINES],
            'lines.*.stock_item_id' => [
                'required',
                'uuid',
                Rule::exists('stock_items', 'id')->where('organisation_id', $organisationId),
            ],
            'lines.*.quantity' => ['required', 'numeric', 'decimal:0,4', 'gt:0', 'max:'.self::MAX_QUANTITY],
        ]);

        $attributes = [];

        // `array_key_exists` rather than `isset`: `notes: null` is a clear, and
        // `isset` cannot tell it from an omitted key.
        if (array_key_exists('notes', $validated)) {
            $attributes['notes'] = $validated['notes'] === null ? null : (string) $validated['notes'];
        }

        if (array_key_exists('lines', $validated)) {
            $attributes['lines'] = array_values(array_map(
                static fn (array $line): array => [
                    'stock_item_id' => (string) $line['stock_item_id'],
                    'quantity' => (string) $line['quantity'],
                ],
                $validated['lines'],
            ));
        }

        $orders->updateDraft($order, $attributes);

        $fresh = PurchaseOrder::query()
            ->with(['supplier', 'branch', 'lines'])
            ->whereKey($purchaseOrder)
            ->firstOrFail();

        return ApiResponse::data(['purchase_order' => $this->presenter->purchaseOrder($fresh)]);
    }
}
