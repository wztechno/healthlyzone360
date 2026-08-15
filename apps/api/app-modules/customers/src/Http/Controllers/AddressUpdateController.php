<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Http\Requests\UpdateAddressRequest;
use Healthy360\Customers\Presenters\CustomerAddressPresenter;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/me/addresses/{address} — correct one in place.
 *
 * A partial update rather than a replace, because that is what the act is:
 * somebody adds a floor number they left out, or renames "Home" to "Mum's". A
 * `PUT` would require the client to resend every field to change one, and the
 * first client that forgot a field would silently erase the directions a driver
 * needs.
 *
 * **No `If-Match`.** `customer_addresses` carries `lock_version` like every
 * other versioned row, but nothing here is guarded by `precondition` and that
 * is deliberate rather than an omission: this resource has exactly one writer —
 * its owner, on their own device — so the concurrent-edit problem optimistic
 * concurrency exists to solve does not arise. The validator is still served, so
 * the day a second writer appears the contract can be tightened without a
 * change of shape.
 *
 * `delivery_area_id` may move and coverage is rechecked when it does; the
 * address's *type* may not, and `is_default` has its own endpoint. Both
 * exclusions are argued in `UpdateAddressRequest` — they are correctness, not
 * taste.
 */
final class AddressUpdateController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly CustomerAddressService $addresses,
        private readonly CustomerAccountLifecycle $lifecycle,
        private readonly CustomerAddressPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateAddressRequest $request, string $address): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccount($user);
        $record = $this->addressFor($account, $address);

        $updated = $this->addresses->update($record, $request->payload(), (string) $user->getKey());

        $this->lifecycle->touch($account);

        return ApiResponse::data(
            ['address' => $this->presenter->address($updated, $this->addresses->isDeliverable($updated))],
        );
    }
}
