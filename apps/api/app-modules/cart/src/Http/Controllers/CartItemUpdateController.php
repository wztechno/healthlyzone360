<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Controllers;

use Healthy360\Cart\Http\Requests\UpdateCartItemRequest;
use Healthy360\Cart\Presenters\CartPresenter;
use Healthy360\Cart\Services\CartLocator;
use Healthy360\Cart\Services\CartService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/carts/{cart}/items/{item} — set a line to an exact quantity.
 *
 * **Set, not adjust.** The body carries the quantity the customer wants, not a
 * delta, because a delta applied to a basket that has changed underneath the
 * client produces a number nobody asked for — and the one client that would
 * send a delta is the one whose render is stale.
 *
 * The new quantity is **reprobed** and can be refused, which is the part worth
 * knowing: raising a line can cross a tier the kitchen prices in another
 * currency, and lowering it can fall below the only tier that priced the
 * article at all. Both are `cart.line_refused`, and both are invisible from the
 * number alone — which is why this is not a write the server may simply
 * accept.
 *
 * The whole cart comes back, for `CartItemStoreController`'s reason: the write
 * moved the basket's validator and pushed its expiry out, so a response
 * carrying only the line would hand back a client two stale facts.
 */
final class CartItemUpdateController
{
    public function __construct(
        private readonly CartLocator $locator,
        private readonly CartService $carts,
        private readonly CartPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateCartItemRequest $request, string $cart, string $item): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper();
        $basket = $this->locator->cart($account, $cart);
        $line = $this->locator->line($basket, $item);

        $updated = $this->carts->setQuantity($basket, $line, $payload['quantity']);

        $lines = $basket->items()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data([
            'line' => $this->presenter->line($updated),
            'cart' => $this->presenter->cart($basket, $lines),
        ])->withHeaders(['ETag' => '"'.$basket->lock_version.'"']);
    }
}
