<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use App\Models\User;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * How every `/me/subscriptions` endpoint finds the rows it is about.
 *
 * **The twin of `OrderLocator`, and it exists for the same reason.**
 * `subscriptions` carries no PostgreSQL policy and no global Eloquent scope —
 * the holder is a customer who is a member of no organisation, so an ambient
 * organisation scope would hide somebody's own plan from them. That decision
 * moves the burden here: every consumer-facing read of a subscription goes
 * through a method that names whose it wants, and there is no method that
 * forgets to.
 *
 * **A subscription that is not the caller's is `resource.not_found`, never a
 * 403.** The scope is the lookup rather than a check performed after it, which
 * is what makes that structural: the row is never loaded, so there is nothing
 * to leak by accident. A denial would confirm that a guessed identifier names a
 * real standing arrangement, and the row it names carries a delivery address, a
 * weekday pattern and a price somebody negotiated.
 *
 * **`b2c` only, like `ResolvesCustomerAccount`.** The partial unique index
 * permits one consumer account per person, but a B2B buyer may hold others, and
 * a self-service subscription surface that landed on a company's account would
 * show one employee the standing orders of their employer.
 */
final readonly class SubscriptionLocator
{
    /**
     * Narrows the guard's Authenticatable to the concrete Healthy360 identity.
     *
     * Unreachable in practice — every route using this is behind
     * `auth:sanctum` — and present so that a routing mistake fails closed with
     * `auth.unauthenticated` rather than with a type error.
     *
     * @throws ApiException
     */
    public function user(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }

    /**
     * The caller's consumer account.
     *
     * `account.verification_required` when they have not opened one, matching
     * `ResolvesCustomerAccount::customerAccount()`: a subscription is a write,
     * and a write to an account that does not exist has to say what to do
     * about it rather than answer 404 about a resource the caller never named.
     *
     * @throws ApiException
     */
    public function shopper(Request $request): CustomerAccount
    {
        $account = CustomerAccount::query()
            ->where('user_id', $this->user($request)->getKey())
            ->where('account_type', CustomerAccountType::B2c)
            ->first();

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(
                ErrorCode::AccountVerificationRequired,
                'Open a customer account before using this endpoint.',
                ['account_opened' => false, 'outstanding' => []],
            );
        }

        return $account;
    }

    /**
     * One of this account's subscriptions, or nothing at all.
     *
     * @throws ApiException
     */
    public function subscription(CustomerAccount $account, string $subscriptionId): Subscription
    {
        $subscription = Subscription::query()
            ->where('customer_account_id', $account->getKey())
            ->whereKey($subscriptionId)
            ->first();

        if (! $subscription instanceof Subscription) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $subscription;
    }

    /**
     * One of this account's addresses.
     *
     * Scoped rather than checked, for the reason above: an address belonging to
     * somebody else is `resource.not_found`. `SubscriptionService` refuses an
     * unowned address a second time with `address_not_owned`, which is not
     * redundant — the service is also reached from the console command and from
     * whatever calls it next, and a scope enforced only in a controller is a
     * scope one caller away from being absent.
     *
     * @throws ApiException
     */
    public function address(CustomerAccount $account, string $addressId): CustomerAddress
    {
        $address = CustomerAddress::query()
            ->where('customer_account_id', $account->getKey())
            ->whereKey($addressId)
            ->first();

        if (! $address instanceof CustomerAddress) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $address;
    }
}
