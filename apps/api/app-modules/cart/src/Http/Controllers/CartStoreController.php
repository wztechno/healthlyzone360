<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Controllers;

use Healthy360\Cart\Http\Requests\StoreCartRequest;
use Healthy360\Cart\Presenters\CartPresenter;
use Healthy360\Cart\Services\CartLocator;
use Healthy360\Cart\Services\CartService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/carts — the customer's open basket on a channel, opening one if
 * there is none.
 *
 * **200, not 201, and the verb is still POST.** Get-or-create is not a
 * creation: the second call returns the basket the first one opened, and a
 * client that saw 201 twice would reasonably conclude it had two. It is not a
 * GET either, because the first call genuinely writes — a `cart.opened` audit
 * event and a row — and a GET that creates rows is a GET a proxy will cache and
 * a crawler will trigger. POST returning 200 is the honest reading of
 * "idempotent command", and it is what the one-open-cart-per-channel partial
 * unique index makes true rather than merely intended.
 *
 * The response carries the lines, because "open my basket" and "what is in it"
 * are one interaction. On a freshly opened cart the list is empty, which is a
 * fact rather than an omission.
 *
 * `ETag` is served because a cart carries `lock_version` and a client
 * re-renders the whole basket. No `If-Match` is demanded on the writes,
 * though — a basket has exactly one author, so the lost update the header
 * exists to prevent is a race a customer would have to run against themselves.
 * The validator is there to let a client tell a stale render apart from a
 * current one, not to arbitrate.
 */
final class CartStoreController
{
    public function __construct(
        private readonly CartLocator $locator,
        private readonly CartService $carts,
        private readonly CartPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreCartRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper();
        $channel = $this->locator->channel($payload['channel_code']);

        $cart = $this->carts->getOrCreate($account, $channel);
        $lines = $cart->items()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['cart' => $this->presenter->cart($cart, $lines)])
            ->withHeaders(['ETag' => '"'.$cart->lock_version.'"']);
    }
}
