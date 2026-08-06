<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Http\Requests\PreviewCheckoutRequest;
use Healthy360\Orders\Services\CheckoutPreviewService;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/checkouts/preview — what a basket would cost, priced for real.
 *
 * **A query, not a command.** Nothing is reserved, nothing is written, and no
 * `Idempotency-Key` is accepted — the same proposal always has the same
 * answer, so there is nothing here for a replay to protect against. `POST`
 * rather than `GET` because the body is larger than a query string should
 * carry and a cart identifier is not something to put in server access logs.
 *
 * **Every amount is resolved server-side, the same way placement resolves
 * it.** `CheckoutPreviewService` runs the identical `LineProbe` and
 * `ZoneResolver` paths `OrderPlacementService` runs at checkout, so a preview
 * and the placement it precedes never quote two different numbers for a
 * basket nothing has changed about.
 *
 * `customer_address_id` is the one field this preview accepts that placement
 * does not make optional. A shopper previews a total before choosing where it
 * goes — the cart screen has no address at all yet — and an absent address is
 * reported as the `address_missing` warning rather than refused, because a
 * preview has no transaction to abort.
 *
 * A cart or an address that is not the caller's own is `404
 * resource.not_found`, exactly as `OrderLocator` answers it for placement:
 * confirming that an identifier exists but belongs to somebody else is a
 * disclosure either way.
 */
final class CheckoutPreviewController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly CheckoutPreviewService $preview,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(PreviewCheckoutRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper();
        $cart = $this->locator->cart($account, $payload['cart_id']);

        $addressId = $payload['customer_address_id'] ?? null;
        $address = $addressId === null ? null : $this->locator->address($account, $addressId);

        $requestedDate = $payload['requested_delivery_date'] ?? null;

        $result = $this->preview->preview(
            $cart,
            $address,
            $payload['delivery_window_code'] ?? null,
            $requestedDate === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $requestedDate)->startOfDay(),
        );

        return ApiResponse::data([
            'preview' => [
                'cart_id' => $result->cartId,
                'currency_code' => $result->currencyCode,
                'subtotal_minor' => $result->subtotalMinor,
                'delivery_fee_minor' => $result->deliveryFeeMinor,
                'total_minor' => $result->totalMinor,
                'line_count' => $result->lineCount,
                'warnings' => $result->warnings,
            ],
        ]);
    }
}
