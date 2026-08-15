<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Http\Requests\StoreAddressRequest;
use Healthy360\Customers\Presenters\CustomerAddressPresenter;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/addresses — add a place food can go.
 *
 * The served-area rule is checked at save time and refused as
 * `address.area_not_served` — a 422, because the area is a perfectly valid
 * reference and what fails is the usefulness of the combination rather than its
 * shape. `AreaNotServed` renders itself; nothing is caught here.
 *
 * Checking now rather than at checkout is a deliberate trade. It means a person
 * moving to an uncovered district is told while they are looking at the address
 * form, which is the only moment they can do anything about it — an address
 * accepted here and refused at the till would have wasted a basket and a
 * decision. It applies to delivery addresses only: an invoice goes wherever the
 * customer says, and a billing address in a city no kitchen reaches is not a
 * problem.
 *
 * The first address of a type becomes the default whether or not it was asked
 * for. An address book with no default makes the checkout ask a question that
 * has exactly one possible answer.
 */
final class AddressStoreController
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
    public function __invoke(StoreAddressRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccount($user);

        $payload = $request->payload();

        // Rebuilt rather than forwarded whole: `address_type` and
        // `delivery_area_id` are the service's own named parameters, and an
        // attributes array that still carried them would be writing the same
        // two facts twice.
        $address = $this->addresses->add(
            account: $account,
            type: CustomerAddressType::from($payload['address_type']),
            deliveryAreaId: $payload['delivery_area_id'],
            attributes: [
                'label' => $payload['label'] ?? null,
                'line_one' => $payload['line_one'],
                'line_two' => $payload['line_two'] ?? null,
                'building' => $payload['building'] ?? null,
                'floor' => $payload['floor'] ?? null,
                'apartment' => $payload['apartment'] ?? null,
                'directions' => $payload['directions'] ?? null,
                'postal_code' => $payload['postal_code'] ?? null,
                'contact_point_id' => $payload['contact_point_id'] ?? null,
                'is_default' => (bool) ($payload['is_default'] ?? false),
            ],
            actorUserId: (string) $user->getKey(),
        );

        // Somebody filling in their details is not an abandoned account, and
        // the purge reads this column to tell the two apart.
        $this->lifecycle->touch($account);

        return ApiResponse::data(
            ['address' => $this->presenter->address($address, $this->addresses->isDeliverable($address))],
            status: 201,
        );
    }
}
