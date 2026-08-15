<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Models\Cart;
use Healthy360\Customers\Guest\Http\Middleware\ResolveGuestSession;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Http\Requests\PlaceGuestOrderRequest;
use Healthy360\Orders\Presenters\GuestOrderPresenter;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/guest/orders — `guest.session:place_order`, `idempotency`.
 *
 * A guest turns a basket into an obligation. The same body, the same service
 * and the same refusals as the authenticated `POST /orders`; what differs is
 * only which credential got the caller here.
 *
 * ## The grade is in the routing table, not in this class
 *
 * `guest.session:place_order` is the whole authorisation check, and it is
 * stated beside the path so that "this endpoint needs a proven contact" is
 * visible to somebody reading the routes rather than buried in a controller.
 * A session that has not verified a destination is refused with the same
 * indistinguishable `401` an unknown token gets — a checkout that said "your
 * session is real but not verified" would be telling a token-guesser that a
 * guess had landed.
 *
 * `OrderPlacementService` checks the grade *again* through
 * `CheckoutEligibility`, and the duplication is deliberate rather than
 * redundant: a placement made by a job or a console command never passes
 * through this middleware, and the service is where the invariant has to hold.
 *
 * ## Both identifiers are scoped, and both refusals are `404`
 *
 * The cart and the address are loaded `where customer_account_id = <this
 * session's account>`. A cart that does not exist and a cart belonging to
 * another guest get the same answer, because the difference is only ever useful
 * to somebody walking identifiers. This is the check the form request
 * deliberately does not make: an `exists:` rule would accept another guest's
 * basket and leave the scoping to whatever ran next.
 *
 * ## Idempotency, twice, on purpose
 *
 * The route carries the `idempotency` middleware **and** the key is passed into
 * `place()`. They guard different things and neither subsumes the other. The
 * middleware answers a *replay* with the original envelope — status, body and
 * all — which a service cannot do, because by the time it is asked the response
 * is gone. `OrderIdempotency` guarantees the *placement* runs once, which the
 * middleware cannot promise for a caller that never sent a header or for a
 * checkout that arrives from a queue. A double-tapped button is caught by the
 * first; a retried job is caught by the second.
 *
 * `EnforceIdempotency` keys on the guest customer account published by
 * `guest.session`, which is why the two middlewares must be declared in that
 * order.
 *
 * ## The replay status
 *
 * A fresh placement is `201`, and so is a replay — the middleware repeats the
 * original response exactly, status included, and says which it was with
 * `Idempotency-Replayed: true`. The order genuinely was created; a `200` would
 * be the reply that lies. `meta.replayed` carries the same fact for a client
 * that would rather read a field than a header.
 *
 * The `200` branch below is unreachable through HTTP when a key is present, and
 * survives for the keyless placement a queued job replays through the service.
 */
final class GuestOrderStoreController
{
    public function __construct(
        private readonly OrderPlacementService $placement,
        private readonly GuestOrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(PlaceGuestOrderRequest $request): JsonResponse
    {
        /** @var GuestSession $session */
        $session = $request->attributes->get(ResolveGuestSession::ATTRIBUTE_SESSION);

        $payload = $request->payload();

        $cart = Cart::query()
            ->whereKey($payload['cart_id'])
            ->where('customer_account_id', $session->customer_account_id)
            ->first();

        if (! $cart instanceof Cart) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No basket with that identifier belongs to this session.');
        }

        $address = CustomerAddress::query()
            ->whereKey($payload['customer_address_id'])
            ->where('customer_account_id', $session->customer_account_id)
            ->first();

        if (! $address instanceof CustomerAddress) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No address with that identifier belongs to this session.');
        }

        $requestedDate = $payload['requested_delivery_date'] ?? null;

        $result = $this->placement->place(
            cart: $cart,
            address: $address,
            deliveryWindowCode: $payload['delivery_window_code'] ?? null,
            requestedDate: is_string($requestedDate) ? CarbonImmutable::parse($requestedDate)->startOfDay() : null,
            idempotencyKey: $this->idempotencyKey($request),
        );

        $order = $result->order->loadMissing('lines');

        return ApiResponse::data(
            ['order' => $this->presenter->order($order, $this->locale($request))],
            ['replayed' => $result->replayed],
            status: $result->replayed ? 200 : 201,
        );
    }

    /**
     * The client's replay key, or nothing.
     *
     * Trimmed and emptiness-checked before it is passed on, so that a client
     * sending `Idempotency-Key: ` — a header a proxy or a template can produce
     * by accident — claims no key at all rather than claiming the key `''`,
     * which every other such client would also claim.
     */
    private function idempotencyKey(Request $request): ?string
    {
        $key = $request->header('Idempotency-Key');

        return is_string($key) && trim($key) !== '' ? trim($key) : null;
    }

    /**
     * Which language the frozen line names are rendered in. Two values because
     * the snapshot has two columns; anything else falls back to English rather
     * than serving a blank receipt.
     */
    private function locale(Request $request): string
    {
        return str_starts_with(strtolower((string) $request->header('Accept-Language')), 'ar') ? 'ar' : 'en';
    }
}
