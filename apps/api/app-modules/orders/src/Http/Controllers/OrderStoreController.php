<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Http\Requests\StoreOrderRequest;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/orders — the one irreversible act in the customer journey.
 *
 * **A replay repeats the original response exactly, status included** — `201`
 * again, with `Idempotency-Replayed: true` to say which it was. That is the
 * middleware's contract and it is the right one: the order genuinely was
 * created, so downgrading a replay to `200` would be the reply that lies, and a
 * client that retried a request whose response it lost wants exactly the answer
 * it missed. The header is the signal; the status is the record.
 *
 * The `200` branch below is therefore **not** reachable through HTTP when a key
 * is present — the middleware answers first. It survives for the placement that
 * arrives with no key at all and is replayed by the service, which is the path a
 * queued job or a console command takes.
 *
 * **The `Idempotency-Key` header is read here and passed down**, in addition to
 * the `idempotency` middleware on the route. Two guards, and neither is
 * redundant. The middleware answers a replay with the stored *envelope*, which
 * a service cannot do — by the time it runs, the response is gone. The service
 * claims the key before the order row exists, which is what makes a genuine
 * race an insert conflict rather than a check-then-act two requests can both
 * pass — and it also protects a placement made by a queued job or a console
 * command, which never passes through a middleware at all. In practice the
 * middleware usually answers first; the service's claim is what holds when it
 * cannot.
 *
 * No `If-Match`. Nothing existing is written: the cart is converted inside the
 * placement transaction, and its validator is not a thing a checkout screen
 * has been holding — the customer has been on an address form.
 *
 * Refusals are `order.placement_refused` (409) carrying **every** reason at
 * once. A checkout that revealed one problem per attempt — verify your email,
 * now add an address, now that article is withdrawn, now the cut-off has
 * passed — is four round trips and a lost customer.
 */
final class OrderStoreController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderPlacementService $placement,
        private readonly OrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreOrderRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper();
        $cart = $this->locator->cart($account, $payload['cart_id']);
        $address = $this->locator->address($account, $payload['customer_address_id']);

        $requestedDate = $payload['requested_delivery_date'] ?? null;
        $idempotencyKey = $request->header('Idempotency-Key');

        $result = $this->placement->place(
            $cart,
            $address,
            $payload['delivery_window_code'] ?? null,
            $requestedDate === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $requestedDate)->startOfDay(),
            is_string($idempotencyKey) && trim($idempotencyKey) !== '' ? trim($idempotencyKey) : null,
        );

        $order = $result->order;
        $lines = $order->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(
            ['order' => $this->presenter->customer($order, $lines)],
            status: $result->replayed ? 200 : 201,
        );
    }
}
