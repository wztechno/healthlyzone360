<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Services\SupplierItemLinkService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /catalogue/procurement/supplier-links?supplier_id=…&stock_item_id=…
 *
 * The pair travels in **query parameters** rather than in a body. Every other
 * delete in this API identifies its subject in the URL — `/aliases/{alias}`,
 * `/contacts/{contact}`, `/carts/{cart}/items/{item}` — and a request body on a
 * `DELETE` is the one shape this codebase has never used and that proxies and
 * HTTP clients handle least reliably. The identifying pair is not a payload; it
 * is which row, so it belongs where every other "which row" already lives.
 *
 * Idempotent: deleting a link that is not there answers `204` rather than
 * `404`, because the caller's intention — "they do not sell us this" — is
 * already true, and a screen that unlinks a row somebody else unlinked a second
 * earlier should not show an error for agreeing with them.
 *
 * A real delete, unlike a supplier's own record, which only archives. The
 * difference is what the row *is*: a link is current configuration, and every
 * receipt posted against the supplier stays exactly as it is whether the link
 * stands or not. Both ends are still validated against the active organisation,
 * so another kitchen's supplier or shelf is `404` rather than a silent no-op.
 *
 * Requires `inventory.manage_organisation`.
 */
final class SupplierLinkDeleteController
{
    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, SupplierItemLinkService $links): Response
    {
        $validated = $request->validate([
            'supplier_id' => ['required', 'uuid'],
            'stock_item_id' => ['required', 'uuid'],
        ]);

        $links->delete((string) $validated['supplier_id'], (string) $validated['stock_item_id']);

        return ApiResponse::noContent();
    }
}
