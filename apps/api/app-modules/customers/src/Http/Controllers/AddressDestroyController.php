<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Services\CustomerAddressService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/me/addresses/{address} — remove one.
 *
 * A real delete, unlike a contact point. An address is not evidence of
 * anything: nobody's account recovery depends on it, no duplicate index has to
 * remember that it was claimed, and a person who has moved is entitled to have
 * their old street stop being stored. The audit trail records that an address
 * was removed without recording the address, which is the right amount of
 * memory to keep about somebody's home.
 *
 * Removing the default promotes a replacement, inside the same transaction.
 * That is not a nicety: an account left with addresses and no default makes the
 * checkout ask which one, every time, for no reason.
 *
 * Deleting the last delivery address is allowed and will make the account
 * unable to activate. That is honest — the checklist will say so on the next
 * read — and refusing would trap somebody in a district we no longer serve.
 */
final class AddressDestroyController
{
    use ResolvesCustomerAccount;

    public function __construct(private readonly CustomerAddressService $addresses) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $address): Response
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccount($user);

        $this->addresses->remove($this->addressFor($account, $address));

        return ApiResponse::noContent();
    }
}
