<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\B2b\Presenters\OrganisationInvitationPresenter;
use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Http\Requests\InviteKitchenOwnerRequest;
use Healthy360\PlatformAdministration\Services\KitchenOrganisationLocator;
use Healthy360\PlatformAdministration\Services\KitchenOwners;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/platform/organisations/kitchens/{organisation}/owners/invitations
 * — offer somebody ownership of a kitchen.
 *
 * Re-inviting the same address supersedes the outstanding offer rather than
 * adding a second: `InvitationService::issue()` revokes the live one inside
 * the same transaction, and the partial unique index would refuse a duplicate
 * anyway. So this is safe to press twice, which is what an operator does when
 * somebody says they never got the email.
 *
 * `mailed` is reported honestly. A transport failure does not lose the
 * invitation — the row and its token exist — but it does mean nobody has been
 * told, and a console that showed an unqualified success would leave an
 * operator waiting for a reply to a message that was never sent.
 *
 * `B2b`'s presenter is reused rather than copied. It is the wire shape of an
 * `organisation_invitations` row and this is an `organisation_invitations`
 * row; a second presenter would be a second answer to one question, and its
 * most important property — that there is no `token` field and there never may
 * be — is not one worth reimplementing.
 */
final class PlatformKitchenOwnerInvitationController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly KitchenOrganisationLocator $locator,
        private readonly KitchenOwners $owners,
        private readonly OrganisationInvitationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(InviteKitchenOwnerRequest $request, string $organisation): JsonResponse
    {
        $kitchen = $this->locator->kitchen($organisation);
        $payload = $request->payload();

        $result = $this->owners->invite(
            $kitchen,
            $payload['email'],
            $payload['name'],
            $payload['message'],
            $this->currentUser($request),
        );

        return ApiResponse::data([
            'invitation' => $this->presenter->invitation($result['invitation']),
            'mailed' => $result['mailed'],
        ], status: 201);
    }
}
