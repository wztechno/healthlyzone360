<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Concerns;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Who the desk is selling to, and where — resolved by identifier, never by
 * inference.
 *
 * ## `ShopperResolver` is the wrong door, and it is worth saying why
 *
 * Every other order-placing surface on this platform asks
 * `ShopperResolver::resolve()` who the customer is, because on those surfaces
 * the customer *is* the caller. Here the caller is a member of staff, and
 * `ShopperResolver` answers with the account belonging to **them** — worse, for
 * a request carrying an organisation context it prefers that organisation's own
 * corporate buyer account. A desk agent selling a sandwich to a walk-in would
 * silently place the order against the kitchen's own B2B buyer, on the kitchen's
 * own agreement, and every gate downstream would pass. So the desk names both
 * parties explicitly and this trait is the only way it does it.
 *
 * ## The scoping rule, stated plainly
 *
 * **The account is resolved by identifier with no organisation filter. The
 * address must belong to that account.**
 *
 * The second half is a real control and the first half deliberately is not, so
 * it is worth being exact about what protects what.
 *
 * A `customer_accounts` row is not owned by a kitchen. A consumer who orders
 * from four kitchens has one account, and the row carries no `organisation_id`
 * unless they are a corporate buyer — so there is no filter to apply that would
 * not also lock out every returning customer the moment they ordered somewhere
 * else. What stops an agent enumerating strangers is therefore **not** this
 * lookup: it is that the only way to obtain an account identifier is the desk's
 * customer search, and *that* endpoint is org-scoped (has-an-order-with-this-
 * kitchen, or staff-provisioned by one of its members). This endpoint trusts an
 * identifier the operator could only have got through that door, which is the
 * same posture `OrderLocator::cart()` takes toward a cart identifier and the
 * posture the whole platform takes toward UUIDv7 primary keys: unguessable, and
 * never the sole control on anything confidential.
 *
 * The confidential half **is** guarded, and that is the address. An address is a
 * street somebody lives on; naming one is the disclosure, not naming an account.
 * So the address is looked up **scoped to the account already resolved**, and a
 * mismatch is `404 resource.not_found` rather than a 403 — confirming that an
 * identifier exists but belongs to somebody else is itself the leak, which is
 * the rule `OrderLocator::address()` states and the reason
 * `OrderPlacementService::addressReasons()` gives for answering
 * `address_not_owned` rather than "no such address".
 *
 * The placement service still runs its own ownership check on the way past.
 * That is not redundancy worth removing: this trait guards the *HTTP* boundary
 * so an identifier fails closed before anything reads a street from it, and the
 * service's copy is what gates a placement composed by a job or a console
 * command, which never passes through here.
 *
 * ## Why a trait
 *
 * Two desk endpoints resolve the same pair by the same rule — the quote and the
 * placement — and a quote that resolved a customer differently from the
 * placement behind it would price an order for somebody else. `ReadsPrecondition`
 * is the module's existing precedent for shared controller behaviour that is
 * about the request rather than about the domain.
 */
trait ResolvesDeskParty
{
    /**
     * The customer this sale is for, or null when the desk named nobody.
     *
     * Null is a legal answer and not a fallback: a counter sale to a stranger
     * names no account at all, and inventing one would be the desk creating a
     * customer record every time somebody bought a coffee.
     *
     * @throws ApiException
     */
    protected function deskAccount(?string $customerAccountId): ?CustomerAccount
    {
        if ($customerAccountId === null || $customerAccountId === '') {
            return null;
        }

        $account = CustomerAccount::query()->whereKey($customerAccountId)->first();

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That customer account could not be read.');
        }

        return $account;
    }

    /**
     * The address this order goes to, scoped to the account that owns it.
     *
     * An address supplied with **no** account is refused as not-found rather
     * than resolved unscoped. There is nothing to scope it to, and an address
     * this endpoint could read without naming its owner is precisely the
     * enumeration the account rule above leans on not existing.
     *
     * @throws ApiException
     */
    protected function deskAddress(?CustomerAccount $account, ?string $customerAddressId): ?CustomerAddress
    {
        if ($customerAddressId === null || $customerAddressId === '') {
            return null;
        }

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That address could not be read.');
        }

        $address = CustomerAddress::query()
            ->whereKey($customerAddressId)
            ->where('customer_account_id', $account->getKey())
            ->first();

        if (! $address instanceof CustomerAddress) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That address could not be read.');
        }

        return $address;
    }

    /**
     * The branch that will produce this order, checked against the kitchen.
     *
     * Nullable, because `orders.branch_id` is and because an organisation-wide
     * desk agent genuinely may not know which kitchen will cook it. What it may
     * not be is **another kitchen's** branch: the branch decides which cut-off
     * applies and which branch-scoped delivery zone wins, so an unchecked one
     * would let a desk quote against a neighbour's opening hours and a
     * neighbour's delivery fee — and would confirm, by the answer changing, that
     * a branch with that identifier exists somewhere on the platform.
     *
     * `CartService::validatedBranchId()` states the same rule for a basket and
     * answers the same way: a `422` naming the field, because unlike an address
     * this is a client mistake rather than a disclosure.
     *
     * Checked on the quote as well as the sale, so the two cannot answer
     * differently about the same request.
     *
     * @throws ApiException
     */
    protected function deskBranchId(string $organisationId, ?string $branchId): ?string
    {
        if ($branchId === null || $branchId === '') {
            return null;
        }

        $belongs = OrganisationBranch::withoutTenancy()
            ->whereKey($branchId)
            ->where('organisation_id', $organisationId)
            ->exists();

        if (! $belongs) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That branch is not one of this kitchen.',
                ['fields' => ['branch_id' => ['That branch is not one of this kitchen.']]],
            );
        }

        return $branchId;
    }
}
