<?php

declare(strict_types=1);

namespace Healthy360\Cart\Services;

use Healthy360\Cart\Models\Cart;
use Healthy360\Cart\Models\CartItem;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\ShopperResolver;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Turns route parameters into records this shopper is allowed to see, or into a
 * 404.
 *
 * Route-model binding is not used, matching `CatalogueLocator` and
 * `RecipeLocator` before it, and here the argument is sharper than theirs. A
 * cart carries **no tenancy scope at all** (the owner is a customer who is a
 * member of nothing), so a bound model would arrive at the controller
 * completely unscoped — every basket on the platform reachable by identifier.
 * The scoping is the lookup, so the lookup is not something a router may do on
 * a controller's behalf.
 *
 * **Somebody else's basket is `resource.not_found`, never 403.** Confirming
 * that an identifier exists but belongs to another person is a disclosure, and
 * a basket identifier is guessable in exactly the way an order number is not.
 * The same rule the placement service applies to an address it does not own.
 */
final class CartLocator
{
    public function __construct(private readonly ShopperResolver $shoppers) {}

    /**
     * The customer account behind the authenticated identity.
     *
     * **The consumer account by default**, and a corporate buyer account when
     * the request carries an organisation context the person belongs to. A
     * `guest` account arrives with `X-Guest-Token` rather than with a session.
     *
     * A signed-in person with no customer account is **403
     * `account.verification_required`**, not 404: the account is missing
     * rather than the basket, and answering 404 on a cart the caller never
     * asked for would send a client hunting for a typo in an identifier it had
     * not sent yet. Eligibility to *check out* is a different and later
     * question — `CheckoutEligibility` answers it inside placement — because
     * filling a basket before finishing onboarding is exactly how somebody is
     * persuaded to finish onboarding.
     *
     * @throws ApiException
     */
    public function shopper(): CustomerAccount
    {
        return $this->shoppers->resolve();
    }

    /**
     * Whether this shopper may trade on this channel.
     *
     * Private-pricing channels — wholesale, corporate and insurance desks —
     * refuse every account shape except a corporate buyer account. A consumer
     * seeing a negotiated tariff is the commercial failure K1.5 drew the
     * boundary against.
     *
     * @throws ApiException
     */
    public function assertShopperMayUseChannel(CustomerAccount $shopper, SalesChannel $channel): void
    {
        if (! $channel->channel_kind->hasPrivatePricing()) {
            return;
        }

        if ($shopper->account_type === CustomerAccountType::B2b) {
            return;
        }

        throw new ApiException(
            ErrorCode::CartChannelRefused,
            'This sales channel is only available to corporate buyer accounts.',
            [
                'reasons' => [[
                    'reason' => 'channel_buyer_required',
                    'channel_kind' => $channel->channel_kind->value,
                    'required_account_type' => CustomerAccountType::B2b->value,
                ]],
            ],
        );
    }

    /**
     * One of this shopper's baskets, whatever state it is in.
     *
     * Expired and converted carts are returned rather than hidden: "what did I
     * nearly order" and "what did this order come from" are both legitimate
     * reads, and `CartService` refuses the writes on its own. A locator that
     * also enforced shoppability would be a second answer to a question the
     * service already answers with a better message.
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
     * @throws ApiException
     */
    public function line(Cart $cart, string $id): CartItem
    {
        $line = CartItem::query()
            ->whereKey($id)
            ->where('cart_id', $cart->getKey())
            ->first();

        if (! $line instanceof CartItem) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $line;
    }

    /**
     * The trading channel a basket is opened against, by its code.
     *
     * **Read without tenancy, deliberately.** `SalesChannel` is
     * organisation-scoped and fails closed, and a customer has selected no
     * organisation — the scope would throw before it could return anything.
     * The bypass is what makes a code resolvable across kitchens, which is the
     * whole point: a shopper names the channel they are buying through, and
     * which kitchen owns it is the *answer*, not an input.
     *
     * An inactive channel is `resource.not_found` rather than a 422. A kitchen
     * that has stopped trading through a route to market has stopped offering
     * it, and telling an anonymous-ish caller that a code exists but is
     * switched off leaks a kitchen's commercial state to anybody who can guess
     * a string.
     *
     * @throws ApiException
     */
    public function channel(string $code): SalesChannel
    {
        $channel = SalesChannel::withoutTenancy()
            ->where('code', $code)
            ->where('status', SalesChannelStatus::Active->value)
            ->first();

        if (! $channel instanceof SalesChannel) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $channel;
    }

    /**
     * Resolve a trading channel and confirm the shopper may use it.
     *
     * @throws ApiException
     */
    public function channelForShopper(string $code, CustomerAccount $shopper): SalesChannel
    {
        $channel = $this->channel($code);
        $this->assertShopperMayUseChannel($shopper, $channel);

        return $channel;
    }
}
