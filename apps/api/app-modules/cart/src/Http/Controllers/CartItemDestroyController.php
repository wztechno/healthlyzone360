<?php

declare(strict_types=1);

namespace Healthy360\Cart\Http\Controllers;

use Healthy360\Cart\Services\CartLocator;
use Healthy360\Cart\Services\CartService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/carts/{cart}/items/{item}.
 *
 * **A real delete**, and one of very few on the platform. Almost everything
 * else archives, retires or deactivates, because a price a customer was charged
 * and a label a diner was shown have to stay reconstructable. A basket line is
 * neither: nothing has been promised, nothing has been charged, and a line
 * somebody changed their mind about is not evidence of anything. The removal is
 * audited (`cart.line_removed`), so the decision is still traceable without the
 * row.
 *
 * Its own action rather than a quantity of zero, which is the same rule
 * `CartService` enforces from the other side. "None of this" and "remove this"
 * are different intentions, and collapsing them means a client can delete by
 * arithmetic accident.
 *
 * **204, so no ETag.** The cart's validator did move — the service touches it
 * on every line write — and a client that holds one must re-read the basket
 * rather than trust a header on an empty body. Serving a validator for a
 * representation this response does not contain is how a client ends up
 * confident about a basket it has not seen.
 */
final class CartItemDestroyController
{
    public function __construct(
        private readonly CartLocator $locator,
        private readonly CartService $carts,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $cart, string $item): Response
    {
        $account = $this->locator->shopper();
        $basket = $this->locator->cart($account, $cart);
        $line = $this->locator->line($basket, $item);

        $this->carts->removeItem($basket, $line);

        return ApiResponse::noContent();
    }
}
