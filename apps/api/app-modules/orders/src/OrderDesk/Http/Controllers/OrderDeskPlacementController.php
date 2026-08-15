<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Services\ChannelCurrency;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\OrderDesk\Http\Concerns\ResolvesDeskParty;
use Healthy360\Orders\OrderDesk\Http\Requests\PlaceOrderDeskRequest;
use Healthy360\Orders\OrderDesk\Services\DeskBasket;
use Healthy360\Orders\OrderDesk\Services\DeskChannelLocator;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/order-desk/orders — the kitchen sells something
 * itself.
 *
 * The other side of `POST /orders`. That one is a customer converting their own
 * basket; this is a member of staff placing an order **for** somebody — a
 * walk-in at the counter, a caller on the telephone, a regular collecting at
 * six — and the whole of what makes it different is that the person who pressed
 * the button is not the person who is going to eat.
 *
 * ## `order.create_on_behalf_organisation`
 *
 * Its own code, and not `order.manage_organisation`. Confirming, fulfilling and
 * cancelling change what a customer is already owed; **placing** decides they
 * are owed anything at all, and it is the one order action with nobody on the
 * other side to have agreed to it. It is also the code that carries the
 * eligibility bypass: naming `placed_on_behalf_by` skips the activation
 * checklist entirely, because the member of staff standing in front of the
 * customer is the verification the checklist was asking for. Whoever holds this
 * code *is* that verification.
 *
 * The quote beside it needs only `order.view_organisation`. Asking what a basket
 * would come to commits the kitchen to nothing; this creates an obligation to
 * cook.
 *
 * ## `Idempotency-Key` is mandatory, and the controller enforces it
 *
 * The `idempotency` middleware only enforces *semantics* when a key is present —
 * a request without one passes straight through, which is the right default for
 * the many endpoints where a key is optional and the wrong one here. So an
 * absent or blank header is refused with `400 request.invalid` and
 * `details.header`, before anything runs, exactly as
 * `PlatformB2bApplicationProvisionController` refuses one.
 *
 * It is mandatory here and optional on `POST /orders` because the two have
 * different fallbacks, not different standards. A customer's checkout converts a
 * cart, and `carts` carries a partial unique index — one open cart per customer
 * per channel — so a double-tapped checkout finds the basket already converted
 * and refuses with `cart_not_open`. **A desk sale has no basket and may have no
 * customer at all.** Nothing in the schema would notice a second identical
 * counter sale: two orders, two sets of stock movements at confirm, and a till
 * that is out by one lunch with no row anywhere saying which one was the
 * mistake. The key is the only guard that exists, so it is not optional.
 *
 * Both halves still run. The middleware answers a replay with the stored
 * envelope — the same order, the same `201`, plus `Idempotency-Replayed: true` —
 * which a service cannot do, because by then the response is gone.
 * `OrderPlacementService` claims the key before the order row exists, which is
 * what makes a genuine race an insert conflict rather than a check-then-act two
 * requests can both pass. The `200` branch below is therefore unreachable over
 * HTTP and survives for the same reason `OrderStoreController`'s does: a
 * placement composed by a job replays through the service alone.
 *
 * **A staff placement keys on the member of staff**, never on the customer. See
 * `OrderPlacementService::composedSubject()`: the customer may be an account
 * opened during the call or, on a counter sale, may not exist, and neither is a
 * durable subject for a replay guard. The agent is the one who double-taps.
 *
 * ## No `If-Match`
 *
 * Nothing existing is written. There is no cart to convert and no order to
 * overwrite, so there is no validator a screen could have been holding.
 *
 * ## What the desk is trusted with, and what it is not
 *
 * The customer and the address are resolved **by identifier** — see
 * `ResolvesDeskParty` for the scoping rule and for why `ShopperResolver` would
 * have quietly sold this order to the kitchen's own corporate buyer account.
 *
 * The **prices are not the desk's**. Every line is repriced at placement against
 * the standing tariff, exactly as a customer's basket is; the quote endpoint's
 * numbers were advisory and were never stored. `PriceOverride` exists for one
 * caller — subscription generation grandfathering a subscriber's captured
 * per-day price — and a counter sale is not that. Charging a walk-in a number
 * the desk supplied would put the tariff outside the tariff.
 *
 * Refusals surface as `409 order.placement_refused` carrying every reason at
 * once, which is `PlacementRefused`'s existing envelope and vocabulary: the
 * three shape reasons (`customer_required`, `address_required`,
 * `address_not_applicable`), the address and zone reasons on a delivery, the
 * cut-off on a delivery or a pickup, and the whole line vocabulary folded in per
 * article. The desk screen re-quotes and tells the customer, which is what would
 * have happened if the tariff had moved thirty seconds earlier.
 *
 * The response is the **kitchen** shape. The audience is a member of staff
 * reading their own kitchen's book, so it carries `lock_version` for the confirm
 * that follows and `placed_on_behalf_by` naming who took the order. No
 * `Location` header: nothing on this platform emits one, and inventing the
 * convention on this endpoint would be a client contract nobody else honours.
 */
final class OrderDeskPlacementController
{
    use ResolvesDeskParty;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskChannelLocator $channels,
        private readonly DeskBasket $basket,
        private readonly ChannelCurrency $currencies,
        private readonly OrderPlacementService $placement,
        private readonly OrderPresenter $presenter,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(PlaceOrderDeskRequest $request): JsonResponse
    {
        $idempotencyKey = $this->requiredIdempotencyKey($request);

        $payload = $request->payload();

        $organisationId = $this->locator->sellerId();
        $channel = $this->channels->forOrganisation($organisationId);

        $account = $this->deskAccount($payload['customer_account_id']);
        $address = $this->deskAddress($account, $payload['customer_address_id']);
        $branchId = $this->deskBranchId($organisationId, $payload['branch_id']);

        $requestedDate = $payload['requested_delivery_date'];

        $result = $this->placement->placeComposed(
            new ComposedPlacement(
                account: $account,
                address: $address,
                organisationId: $organisationId,
                salesChannelId: (string) $channel->getKey(),
                branchId: $branchId,
                // The channel's own tariff currency, resolved by the class a
                // cart's currency is resolved by. A desk sale has no basket to
                // have been denominated earlier, so the question is asked here
                // and answered identically.
                currencyCode: $this->currencies->for($channel),
                lines: $this->basket->aggregate($payload['lines']),
                deliveryWindowCode: $payload['delivery_window_code'],
                requestedDate: $requestedDate === null
                    ? null
                    : CarbonImmutable::createFromFormat('Y-m-d', $requestedDate)->startOfDay(),
                fulfilmentType: FulfilmentType::from($payload['fulfilment_type']),
                placedOnBehalfBy: $this->agentId(),
                paymentMethod: PaymentMethod::from($payload['payment_method']),
            ),
            $idempotencyKey,
        );

        $order = $result->order;
        $lines = $order->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(
            ['order' => $this->presenter->kitchen($order, $lines)],
            status: $result->replayed ? 200 : 201,
        );
    }

    /**
     * The member of staff this order is placed on behalf of.
     *
     * `TenantContext` rather than `$request->user()`, which is the module's
     * idiom for this column's neighbours — `OrderPlacementService` writes
     * `created_by` from exactly here, and the two fields on one row disagreeing
     * about which user placed the order would be worse than either being wrong.
     *
     * **Null fails closed rather than defaulting.** A null
     * `placed_on_behalf_by` is not a missing detail: it *is* the marker that
     * says nobody at a desk placed this, and it would silently re-enable the
     * activation checklist for a cold caller who cannot satisfy it. Unreachable
     * behind `auth:sanctum` and `db.context`; present so that a routing mistake
     * refuses instead of placing an order that lies about its own provenance.
     *
     * @throws ApiException
     */
    private function agentId(): string
    {
        $userId = $this->context->userId();

        if ($userId === null || $userId === '') {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $userId;
    }

    /**
     * @throws ApiException
     */
    private function requiredIdempotencyKey(Request $request): string
    {
        $key = $request->header('Idempotency-Key');

        if (! is_string($key) || trim($key) === '') {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A desk sale has no basket to be converted twice, so a retry with no key would place a second order nobody could tell from the first. Send an Idempotency-Key.',
                ['header' => 'Idempotency-Key'],
            );
        }

        return trim($key);
    }
}
