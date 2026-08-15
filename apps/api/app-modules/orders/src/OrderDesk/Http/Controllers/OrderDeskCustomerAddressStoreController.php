<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Exceptions\AreaNotServed;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Presenters\CustomerAddressPresenter;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Orders\OrderDesk\Http\Requests\StoreOrderDeskCustomerAddressRequest;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/order-desk/customers/{account}/addresses — where the
 * food is going.
 *
 * The second half of writing down a cold caller, and a separate request from the
 * first for a reason a desk agent would recognise: the name and the number come
 * out in the first ten seconds of a call, and the address takes a minute and
 * three corrections. Folding it into the account body would mean an agent who
 * mis-heard a street re-sending the whole customer.
 *
 * ## This endpoint is the app-layer control the RLS migration names
 *
 * `2026_08_16_003006` states plainly that staff-provisioned accounts have **no
 * database-layer isolation** — they are ownerless rows and the policy's third
 * arm admits every one of them to every kitchen session — and that the whole
 * control is the permission code plus the desk's app-layer scoping. This is the
 * endpoint where that matters most, because what it writes is **a street
 * somebody lives on**.
 *
 * So the account is resolved by identifier and then put through
 * `DeskCustomerDirectory::isInScope()` — the *same* rule the search applies:
 * this kitchen holds an order for them, or somebody with an active membership
 * here wrote them down. An identifier that fails it is `404 resource.not_found`,
 * not a 403, on `ResolvesDeskParty`'s and `OrderLocator::address()`'s argument:
 * confirming that an identifier exists but belongs to somebody else is itself
 * the disclosure.
 *
 * ## The service is unchanged, and both of its rules still apply
 *
 * `CustomerAddressService::add()` is called exactly as `/me/addresses` calls it.
 * The served-area check runs — an area nobody delivers to is
 * `422 address.area_not_served`, rendered by `AreaNotServed` itself and caught
 * nowhere — and the first address of a type becomes the default. Neither is
 * relaxed for the desk: an agent told at the moment of typing that the kitchen
 * does not reach that district is an agent who can say so while the customer is
 * still on the telephone, which is the only moment it is useful.
 *
 * `is_deliverable` comes back on the response because coverage moves, and the
 * flag is recomputed on every read rather than frozen at save time.
 *
 * ## No `Idempotency-Key`, and that is the sibling's answer
 *
 * `POST /me/addresses` carries none, and the failure modes differ from the
 * customer-create beside this one. A double-tapped address is a **visible**
 * duplicate on a screen the agent is already looking at, deletable in one tap;
 * a double-tapped customer is a second person in the file that nobody notices
 * until the next call. Requiring a key here would also make the desk's address
 * flow diverge from the customer's own for no gain.
 */
final class OrderDeskCustomerAddressStoreController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly CustomerAddressService $addresses,
        private readonly CustomerAddressPresenter $presenter,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     * @throws AreaNotServed
     */
    public function __invoke(StoreOrderDeskCustomerAddressRequest $request, string $account): JsonResponse
    {
        $customer = $this->inScopeAccount($account);

        $payload = $request->payload();

        $address = $this->addresses->add(
            account: $customer,
            // The desk adds delivery addresses and only delivery addresses —
            // see the request class.
            type: CustomerAddressType::Delivery,
            deliveryAreaId: $payload['delivery_area_id'],
            attributes: [
                'label' => $payload['label'],
                'line_one' => $payload['line_one'],
                'line_two' => $payload['line_two'],
                'building' => $payload['building'],
                'floor' => $payload['floor'],
                'apartment' => $payload['apartment'],
                'directions' => $payload['directions'],
                'postal_code' => $payload['postal_code'],
            ],
            actorUserId: $this->agentId(),
        );

        return ApiResponse::data(
            ['address' => $this->presenter->address($address, $this->addresses->isDeliverable($address))],
            status: 201,
        );
    }

    /**
     * The customer, if this kitchen has any business with them.
     *
     * Both failures answer identically, and deliberately: "no such account" and
     * "an account somebody else's desk wrote down" are the same sentence to a
     * caller who should be able to distinguish neither.
     *
     * @throws ApiException
     */
    private function inScopeAccount(string $accountId): CustomerAccount
    {
        $account = CustomerAccount::query()->whereKey($accountId)->first();

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That customer account could not be read.');
        }

        if (! $this->directory->isInScope($this->locator->sellerId(), $account)) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That customer account could not be read.');
        }

        return $account;
    }

    /**
     * Who added it. Written to `customer_addresses.created_by` and named in the
     * audit record the service writes, so an address that turns out to be wrong
     * has somebody to ask about it.
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
}
