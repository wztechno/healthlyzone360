<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Concerns;

use App\Models\User;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * How every `/me/*` endpoint finds the account it is about, and the rows
 * hanging off it.
 *
 * **There is no account identifier anywhere in these paths**, and that is the
 * design rather than an omission. A consumer surface that took one would need a
 * rule about whose accounts a caller may name, and the only correct rule is
 * "their own" — so the parameter would be a decorative way of stating a fact the
 * server already knows, and the first bug in that rule would be somebody else's
 * address book.
 *
 * **Two resolvers, because reads and writes owe different answers.** A write to
 * an account that has not been opened cannot be performed and must say so:
 * `account.verification_required`, which is the code whose whole purpose is
 * "you lack a standing the platform has not granted you yet". A *read* can
 * answer honestly without one — a person with no account has no addresses, and
 * has declared nothing — so a 403 there would be a refusal in place of a true
 * and useful answer.
 *
 * The refusal carries `account_opened: false` beside an empty `outstanding`,
 * and the pair is deliberate. `outstanding` names the activation requirements
 * still unmet, and with no account there are none to report — not because
 * everything is satisfied but because there is nothing to evaluate. A client
 * reading `account_opened: false` sends the person to `POST /customer-account`;
 * one reading a non-empty `outstanding` sends them to the step it names. Neither
 * has to infer anything from the other's silence.
 */
trait ResolvesCustomerAccount
{
    /**
     * Narrows the guard's Authenticatable to the concrete Healthy360 identity.
     *
     * Every route using this is already behind `auth:sanctum`, so the failure
     * branch is unreachable in practice — it exists so a routing mistake fails
     * closed with `auth.unauthenticated` rather than with a type error.
     *
     * @throws ApiException
     */
    protected function currentUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }

    /**
     * The caller's consumer account, or a refusal naming the way forward.
     *
     * @throws ApiException
     */
    protected function customerAccount(User $user): CustomerAccount
    {
        $account = $this->customerAccountOrNull($user);

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
     * The caller's consumer account if they have opened one.
     *
     * Scoped to `b2c` rather than to the user alone: the partial unique index
     * permits one consumer account per person, but a B2B buyer may hold others,
     * and a `/me/addresses` write that landed on a company's account would put
     * a person's home address on their employer's record.
     */
    protected function customerAccountOrNull(User $user): ?CustomerAccount
    {
        $account = CustomerAccount::query()
            ->where('user_id', $user->getKey())
            ->where('account_type', CustomerAccountType::B2c)
            ->first();

        return $account instanceof CustomerAccount ? $account : null;
    }

    /**
     * One of this account's addresses, or nothing at all.
     *
     * The scope is the lookup, not a check performed after it: an address
     * belonging to somebody else is `resource.not_found`, never a denial,
     * because a denial would confirm that the identifier names a real address
     * and identifiers are guessable in a way home addresses should not be.
     *
     * @throws ApiException
     */
    protected function addressFor(CustomerAccount $account, string $addressId): CustomerAddress
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

    /**
     * One of this person's live contact points.
     *
     * Scoped to the *user* rather than to the account, because that is where a
     * registered person's destinations hang; the account owns only the ones a
     * guest journey wrote. Retired rows are excluded rather than returned in a
     * retired state — retiring is idempotent, and an endpoint that accepted a
     * withdrawn destination as a target would let it be promoted to primary.
     *
     * @throws ApiException
     */
    protected function contactFor(User $user, string $contactId): ContactPoint
    {
        $contact = ContactPoint::query()
            ->where('user_id', $user->getKey())
            ->whereNull('retired_at')
            ->whereKey($contactId)
            ->first();

        if (! $contact instanceof ContactPoint) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $contact;
    }
}
