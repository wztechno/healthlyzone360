<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Presenters\CustomerContactPresenter;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/contacts — the destinations this person has told us about.
 *
 * **No customer account is required to read this**, unlike the addresses and
 * the dietary profile next door, because a registered person's contacts hang
 * off their identity rather than off an account. The login mirror exists from
 * the moment of registration; refusing to show somebody their own email address
 * until they had opened a customer account would be a gate in front of a fact
 * that predates the thing it gates.
 *
 * Retired contacts are absent. Retiring keeps `verified_at` — the destination
 * *was* proven, and a closure or abuse investigation needs to know that — but
 * it is history rather than something a client can act on, and a list that
 * offered one would invite somebody to make it primary.
 *
 * Not cursor-paginated. A person has a handful of destinations, and a cursor
 * over four rows is ceremony; `meta.count` is what the screen actually needs.
 */
final class ContactIndexController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly ContactPointRegistry $contacts,
        private readonly CustomerContactPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);

        $contacts = array_map(
            fn (ContactPoint $contact): array => $this->presenter->contact($contact),
            $this->contacts->forUser($user),
        );

        return ApiResponse::data($contacts, ['count' => count($contacts)]);
    }
}
