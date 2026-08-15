<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Http\Requests\StoreCartItemRequest;
use Healthy360\Cart\Presenters\CartPresenter;
use Healthy360\Cart\Services\CartLocator;
use Healthy360\Cart\Services\CartService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/carts/{cart}/items.
 *
 * **201 even when the line merged.** Adding two of something to a basket that
 * already holds one produces one line of three, not a second line — the unique
 * index guarantees it and `CartService::addItem` implements it — and the
 * response is still "here is the line your request is about, at this URL".
 * Answering 200 on the merge would make the status code a report on the
 * database's internal state, and a client would have to branch on it to learn
 * nothing it could use.
 *
 * The **whole cart comes back beside the line**, deliberately. The service
 * pushes the expiry out and moves `lock_version` on every line write, so a
 * client that received only the line would be holding a stale validator and a
 * stale deadline the moment it rendered. One round trip, one coherent basket.
 *
 * Refusals are `cart.line_refused` (422) carrying **every** reason at once: an
 * article that is retired *and* unpriced *and* not offered on this channel says
 * all three, because a refusal that reveals one problem per attempt turns one
 * fix into three round trips.
 */
final class CartItemStoreController
{
    public function __construct(
        private readonly CartLocator $locator,
        private readonly CartService $carts,
        private readonly CartPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreCartItemRequest $request, string $cart): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper();
        $basket = $this->locator->cart($account, $cart);

        $deliveryDate = $payload['delivery_date'] ?? null;
        $quantity = $payload['quantity'] ?? null;

        $line = $this->carts->addItem(
            $basket,
            $payload['catalogue_item_id'],
            $payload['catalogue_item_variant_id'] ?? null,
            $quantity ?? 1,
            $deliveryDate === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $deliveryDate)->startOfDay(),
        );

        $lines = $basket->items()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data([
            'line' => $this->presenter->line($line),
            'cart' => $this->presenter->cart($basket, $lines),
        ], status: 201)->withHeaders(['ETag' => '"'.$basket->lock_version.'"']);
    }
}
