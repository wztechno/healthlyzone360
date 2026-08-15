<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Presenters\CustomerAddressPresenter;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/me/addresses/{address}/default — nominate the usual one.
 *
 * A POST sub-resource action rather than a `PATCH is_default` (master plan v2
 * §4.15), and here the reason is mechanical as well as stylistic: promoting
 * means demoting the incumbent, the partial unique index refuses a second
 * default per type, and a client performing the pair as two field writes would
 * collide with itself between them. The service does both inside one
 * transaction; this endpoint asks for that transaction and cannot express
 * anything else.
 *
 * The default is per type, so promoting a billing address leaves the delivery
 * default alone. They answer different questions — where the food goes and
 * where the invoice goes — and one flag serving both would silently move an
 * invoice to somebody's office because they ordered lunch there once.
 *
 * An address that is no longer deliverable may still be made default. Coverage
 * is a fact about the world and can change back, refusing here would leave an
 * account with no default at all, and the flag on every read says plainly
 * whether anything can currently be sent.
 */
final class AddressDefaultController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly CustomerAddressService $addresses,
        private readonly CustomerAddressPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $address): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccount($user);

        $promoted = $this->addresses->makeDefault(
            $this->addressFor($account, $address),
            (string) $user->getKey(),
        );

        return ApiResponse::data(
            ['address' => $this->presenter->address($promoted, $this->addresses->isDeliverable($promoted))],
        );
    }
}
