<?php

declare(strict_types=1);

namespace Healthy360\Cart\Presenters;

use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Models\CartItem;

/**
 * The basket as the person filling it sees it.
 *
 * **No money, anywhere, and this time it is not a deferral.** `carts` and
 * `cart_items` hold no amount of any kind: `CartService`'s probe establishes
 * that a line is *orderable* and throws its price away, because a cart price is
 * advisory — the tariff can move between adding a line and paying for it — and
 * `OrderPlacementService` reprices every line at placement. A presenter that
 * invented a subtotal here would be quoting a number no table holds and no
 * checkout will honour, which is worse than showing none. The authoritative
 * total appears on the order, once.
 *
 * There is exactly **one audience**. A cart is one customer's, a kitchen has no
 * screen that reads somebody's unplaced basket, and `CartService::forSeller()`
 * exists for counting abandonment rather than for reading contents. So there is
 * no denylist to state here: every column on both tables is on the shape, and
 * the two that could be sensitive — `organisation_id` and `sales_channel_id` —
 * are the shopper's own answer to "who am I buying from", not the seller's
 * private data.
 *
 * `expires_at` is carried because a basket that quietly vanishes is the
 * complaint the TTL sweep would otherwise generate; a client that can see the
 * deadline can warn about it.
 */
final class CartPresenter
{
    /**
     * @param  iterable<int, CartItem>  $lines
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     sales_channel_id: string,
     *     branch_id: string|null,
     *     status: string,
     *     currency_code: string,
     *     expires_at: string,
     *     lock_version: int,
     *     line_count: int,
     *     lines: list<array{
     *         id: string,
     *         catalogue_item_id: string,
     *         catalogue_item_variant_id: string|null,
     *         quantity: string,
     *         delivery_date: string|null,
     *         created_at: string|null,
     *         updated_at: string|null
     *     }>,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function cart(Cart $cart, iterable $lines): array
    {
        $presented = [];

        foreach ($lines as $line) {
            $presented[] = $this->line($line);
        }

        return [
            'id' => (string) $cart->getKey(),
            'organisation_id' => $cart->organisation_id,
            'sales_channel_id' => $cart->sales_channel_id,
            'branch_id' => $cart->branch_id,
            'status' => $cart->status->value,
            'currency_code' => $cart->currency_code,
            'expires_at' => $cart->expires_at->toIso8601String(),
            'lock_version' => $cart->lock_version,
            'line_count' => count($presented),
            'lines' => $presented,
            'created_at' => $cart->created_at?->toIso8601String(),
            'updated_at' => $cart->updated_at?->toIso8601String(),
        ];
    }

    /**
     * `quantity` is served as the decimal **string** the column holds, never
     * coerced to a number. It is matched against pricing tiers of the same
     * scale, and a 0.3 kg line that arrives back as 0.29999999 sits on the
     * wrong side of a tier boundary — the reason `CartItem` casts it
     * `decimal:4` in the first place.
     *
     * @return array{
     *     id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string|null,
     *     quantity: string,
     *     delivery_date: string|null,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function line(CartItem $line): array
    {
        return [
            'id' => (string) $line->getKey(),
            'catalogue_item_id' => $line->catalogue_item_id,
            'catalogue_item_variant_id' => $line->catalogue_item_variant_id,
            'quantity' => (string) $line->quantity,
            'delivery_date' => $line->delivery_date?->toDateString(),
            'created_at' => $line->created_at?->toIso8601String(),
            'updated_at' => $line->updated_at?->toIso8601String(),
        ];
    }
}
