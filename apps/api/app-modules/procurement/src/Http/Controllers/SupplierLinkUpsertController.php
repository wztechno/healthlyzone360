<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\SupplierItemLinkService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PUT /catalogue/procurement/supplier-links — "we buy this from them" (§3.3).
 *
 * **One idempotent upsert rather than two mirrored set-replaces.** A supplier's
 * supplied items and an item's suppliers are one table read from two ends;
 * giving each end its own replace endpoint would let the supplier page silently
 * unlink every supplier the item page had just added. The body names a *pair*,
 * and sending it twice leaves the same row — which is what makes it a `PUT`.
 *
 * `is_preferred: true` moves the flag: the service clears whichever supplier
 * held it for this stock item inside the same transaction before setting the
 * new one, because the partial unique index behind the rule is checked per
 * statement and a straight handover would otherwise collide mid-swap. Sending
 * `false` clears this link's own flag and promotes nobody — the system has no
 * opinion about who should take over.
 *
 * The response is the link and nothing else. Every ops write in this workspace
 * answers the minimum and lets the screen re-read what it changed; a supplied
 * item's *last purchase price* is derived from the receipt ledger and cannot
 * change because somebody saved a link, so returning it here would be inventing
 * a read the caller did not ask for.
 *
 * Requires `inventory.manage_organisation` at the route — naming who sells the
 * kitchen its flour is the same configuration job as writing the supplier
 * record itself. There is deliberately **no** new permission in this slice.
 */
final class SupplierLinkUpsertController
{
    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, SupplierItemLinkService $links): JsonResponse
    {
        $validated = $request->validate([
            'supplier_id' => ['required', 'uuid'],
            'stock_item_id' => ['required', 'uuid'],
            'is_preferred' => ['nullable', 'boolean'],
            'supplier_item_ref' => ['nullable', 'string', 'max:64'],
        ]);

        $link = $links->upsert(
            (string) $validated['supplier_id'],
            (string) $validated['stock_item_id'],
            isset($validated['is_preferred']) ? (bool) $validated['is_preferred'] : null,
            is_string($validated['supplier_item_ref'] ?? null) ? $validated['supplier_item_ref'] : null,
            // Presence, not null: a body that sends `supplier_item_ref: null`
            // is clearing a reference somebody typed by mistake, while a body
            // that never mentions it leaves the stored one alone.
            referenceGiven: $request->exists('supplier_item_ref'),
        );

        return ApiResponse::data(['supplier_link' => $this->link($link)]);
    }

    /**
     * @return array{
     *     supplier_id: string,
     *     stock_item_id: string,
     *     is_preferred: bool,
     *     supplier_item_ref: string|null
     * }
     */
    private function link(SupplierStockItem $link): array
    {
        return [
            'supplier_id' => (string) $link->supplier_id,
            'stock_item_id' => (string) $link->stock_item_id,
            'is_preferred' => $link->is_preferred,
            'supplier_item_ref' => $link->supplier_item_ref,
        ];
    }
}
