<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Cart\Models\Cart;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Services\ShopperResolver;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * Turns route parameters and body identifiers into records the caller is
 * allowed to reach, or into a 404.
 *
 * Route-model binding is not used, and on this table the reason is at its
 * strongest. `orders` carries **no PostgreSQL policy and no global Eloquent
 * scope** — the row belongs to a customer who is a member of nothing, so an
 * ambient organisation scope would hide an order from the person who placed it
 * — which means a bound `Order` would arrive at a controller with no scoping
 * whatsoever. Every read here therefore names whose orders it wants, and
 * `OrderQuery` is the only door: there is no method in this module that
 * forgets the filter, because there is no method that offers to.
 *
 * **Two audiences, two lookups, and neither is a filter on the other.**
 * `customerOrder()` is a person looking at their own order; `sellerOrder()` is
 * a kitchen looking at its own book. A customer's order that belongs to another
 * kitchen and a kitchen's order that belongs to another customer are both
 * `resource.not_found` — confirming that an identifier exists but is somebody
 * else's is a disclosure, and an order number is printed on a receipt that
 * passes through a courier's hands.
 */
final class OrderLocator
{
    public function __construct(
        private readonly OrderQuery $orders,
        private readonly TenantContext $context,
        private readonly ShopperResolver $shoppers,
    ) {}

    /**
     * The customer account behind the authenticated identity.
     *
     * **The consumer account by default**, and a corporate buyer account when
     * the request carries an organisation context the person belongs to. A
     * `guest` account arrives with `X-Guest-Token` rather than with a
     * session.
     *
     * A signed-in person with no customer account is **403
     * `account.verification_required`** rather than 404: what is missing is the
     * account, not the order, and a 404 would send a client hunting for a typo
     * in an identifier it had not sent. Whether that account may *check out* is
     * a separate and later question, answered by `CheckoutEligibility` inside
     * placement, where it can be folded in beside every other reason at once.
     *
     * Duplicated from `CartLocator` on purpose, and the duplication is eight
     * lines. Sharing it would mean either a public HTTP-layer service reaching
     * across a module boundary or a new port over one query, and the module
     * registry's edge is Orders → Cart for *domain* reasons, not for a lookup
     * both modules can state for themselves.
     *
     * @throws ApiException
     */
    public function shopper(): CustomerAccount
    {
        return $this->shoppers->resolve();
    }

    /**
     * The basket a placement names, scoped to the customer placing it.
     *
     * Scoped **here** rather than left to `OrderPlacementService`, which would
     * happily place somebody else's basket as this customer's order: the
     * service's job is to decide whether a cart is orderable, and it takes the
     * cart as given. Whether this caller may name that cart is an HTTP-layer
     * question, and answering it late would mean an authorisation decision made
     * by whichever check happened to fail first.
     *
     * A cart that is no longer open is still returned — `placement_refused`
     * with `cart_not_open` is a far more useful answer than a 404, because the
     * client holds an identifier that was valid ten minutes ago and needs to be
     * told what became of it.
     *
     * @throws ApiException
     */
    public function cart(CustomerAccount $account, string $id): Cart
    {
        $cart = Cart::query()
            ->whereKey($id)
            ->where('customer_account_id', $account->getKey())
            ->first();

        if (! $cart instanceof Cart) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $cart;
    }

    /**
     * The delivery address a placement names, scoped to its owner.
     *
     * The placement service checks ownership too, and reports it as
     * `address_not_owned` beside every other refusal. That is not redundancy
     * worth removing: a body naming an address is naming a *confidential* row,
     * and the identifier must fail closed before it reaches a service that will
     * read a street from it. The service's version of the check exists so that
     * a job or a console placement is gated identically.
     *
     * @throws ApiException
     */
    public function address(CustomerAccount $account, string $id): CustomerAddress
    {
        $address = CustomerAddress::query()
            ->whereKey($id)
            ->where('customer_account_id', $account->getKey())
            ->first();

        if (! $address instanceof CustomerAddress) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $address;
    }

    /**
     * One of this customer's own orders.
     *
     * @throws ApiException
     */
    public function customerOrder(CustomerAccount $account, string $id): Order
    {
        $order = $this->orders->forCustomer((string) $account->getKey())->whereKey($id)->first();

        if (! $order instanceof Order) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $order;
    }

    /**
     * One of the selling organisation's orders.
     *
     * The organisation comes from `TenantContext`, which `org.context` has
     * already validated against an active membership — never from a query
     * parameter, which would be a client asserting whose book it is reading.
     * A context that somehow arrives unset is `400
     * `context.organisation_required``, the same answer the middleware gives,
     * rather than an unscoped query that would return every kitchen's orders.
     *
     * @throws ApiException
     */
    public function sellerOrder(string $id): Order
    {
        $order = $this->orders->forSeller($this->sellerId())->whereKey($id)->first();

        if (! $order instanceof Order) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $order;
    }

    /**
     * @throws ApiException
     */
    public function sellerId(): string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
    }
}
