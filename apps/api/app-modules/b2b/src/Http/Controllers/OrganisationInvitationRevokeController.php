<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DELETE /api/v1/organisations/{organisation}/invitations/{invitation} —
 * withdraw an outstanding offer.
 *
 * Requires `membership.end_organisation`, inside `org.context` — the same
 * authority as ending a membership, because withdrawing an offer somebody has
 * not yet accepted and removing somebody who has are the same decision taken at
 * two moments. The organisation in the path must be the one in context; a
 * mismatch is `404`. That predicate is the isolation: this table deliberately
 * carries no PostgreSQL policy, for the reason the store controller sets out.
 *
 * **`DELETE`, but nothing is deleted.** `revoked_at` and `revoked_by` are
 * stamped and the row stays, because who was invited and who withdrew it is
 * exactly the trail an access review reads. The verb describes the effect the
 * caller cares about — the offer is gone — and the record of it having existed
 * is not the caller's to remove. The retention job eventually clears *expired*
 * offers, which are the ones that hold an address for no remaining purpose;
 * revoked and accepted rows are kept.
 *
 * Revoking an already-revoked invitation is a **no-op that still answers 204**.
 * The caller asked for the offer to be gone and it is gone; making a retry fail
 * would punish a client for a lost response. Revoking an *accepted* one is
 * `409`, because the answer there is different work — remove the membership.
 *
 * `204` with no body, per the envelope's documented exception.
 */
final class OrganisationInvitationRevokeController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly InvitationService $invitations,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation, string $invitation): Response
    {
        $tenant = $this->locator->contextOrganisation($organisation);
        $record = $this->locator->invitation($tenant, $invitation);

        $this->invitations->revoke($record, $this->currentUser($request));

        return ApiResponse::noContent();
    }
}
