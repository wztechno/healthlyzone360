<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Presenters\CustomerAddressPresenter;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/addresses — the caller's address book.
 *
 * **An empty list when there is no account yet, rather than a refusal.** A
 * person who has not opened a customer account genuinely has no addresses, and
 * that is a true and useful answer; 403 is what a *write* owes, because a write
 * cannot be performed and the client has to be told where to go instead.
 *
 * Both types are listed together. A client rendering a checkout wants the
 * delivery addresses and a client rendering an invoice wants the billing one,
 * and `address_type` separates them in one round trip; two endpoints would be
 * two calls for one screen.
 *
 * `is_deliverable` is computed per row rather than trusted from save time,
 * because coverage moves: a zone is paused, a kitchen closes, and an address
 * that was reachable in March is not in April. A book that showed only what was
 * true when the address was typed would let somebody pick one that nothing can
 * be sent to, and they would find out at checkout.
 */
final class AddressIndexController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly CustomerAddressService $addresses,
        private readonly CustomerAddressPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccountOrNull($user);

        $rows = ! $account instanceof CustomerAccount ? [] : CustomerAddress::query()
            ->where('customer_account_id', $account->getKey())
            ->orderBy('address_type')
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->get()
            ->map(fn (CustomerAddress $address): array => $this->presenter->address(
                $address,
                $this->addresses->isDeliverable($address),
            ))
            ->all();

        return ApiResponse::data($rows, ['count' => count($rows)]);
    }
}
