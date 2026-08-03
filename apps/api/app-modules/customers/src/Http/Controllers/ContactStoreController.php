<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Http\Requests\StoreContactRequest;
use Healthy360\Customers\Presenters\CustomerContactPresenter;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/contacts — add a destination.
 *
 * The row is created **unverified**, always. Declaring a destination proves
 * that somebody typed it into a form, not that they hold it; proving is the
 * passcode journey, and a surface that could write `verified_at` would make
 * every downstream check meaningless.
 *
 * **Idempotent by (owner, channel, value).** A person adding the same number
 * twice has one contact, not two — the registry converges on the row that
 * already exists — so a double tap or a retried request cannot litter somebody's
 * account with duplicates. That is also why the response is 201 either way:
 * distinguishing "created" from "already yours" would be reporting on the
 * database's history rather than on the caller's request, and the caller's
 * request has succeeded in both cases.
 *
 * A value already *proven* by somebody else is refused with
 * `contact.already_in_use` — and only when proven. Two people may both claim an
 * address (a typo, a shared family mailbox) and refusing an unverified claim
 * would let anybody deny an address to its real owner by typing it first.
 * `InvalidContactValue` renders that itself; nothing is caught here.
 */
final class ContactStoreController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly ContactPointRegistry $contacts,
        private readonly CustomerAccountLifecycle $lifecycle,
        private readonly CustomerContactPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreContactRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccount($user);

        $payload = $request->payload();

        $contact = $this->contacts->rememberForUser(
            user: $user,
            channel: ContactChannel::from($payload['channel']),
            value: $payload['value'],
            isPrimary: (bool) ($payload['is_primary'] ?? false),
            label: $payload['label'] ?? null,
        );

        // Somebody filling in their details is not an abandoned account, and
        // the purge reads this column to tell the two apart.
        $this->lifecycle->touch($account);

        return ApiResponse::data(['contact' => $this->presenter->contact($contact)], status: 201);
    }
}
