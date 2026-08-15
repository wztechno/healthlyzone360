<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\StoreOrganisationInvitationRequest;
use Healthy360\B2b\Presenters\OrganisationInvitationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/organisations/{organisation}/invitations — offer somebody a
 * place.
 *
 * Requires `membership.invite_organisation`, inside `org.context`. The
 * organisation in the path must be the one the context already validated a
 * membership against; a mismatch is `404`, because "no such organisation, as
 * far as you are concerned" is the honest answer and confirming that another
 * tenant exists is not.
 *
 * ## The token is never in the response
 *
 * `InvitationService::issue()` returns the plaintext exactly once, for the mail
 * that carries it. Only its SHA-256 reaches the database, and this controller
 * deliberately drops the plaintext on the floor: it never reaches the
 * presenter, a log line, or an audit row. That is what makes three things true
 * at once — a database read cannot be turned into an accepted invitation, a
 * backup or replica cannot either, and the platform genuinely cannot resend the
 * original. Re-inviting issues a new token and revokes the old, which is both
 * the honest behaviour and the safe one.
 *
 * Issuing to an address that already has a live offer **supersedes** it rather
 * than failing on the partial unique index. Two live tokens for one seat means
 * revoking one achieves nothing.
 *
 * ## Row-level security: recorded, not implemented
 *
 * `organisation_invitations` carries **no PostgreSQL policy**, and that is a
 * decision rather than an omission. The accept path resolves an invitation by
 * hashed token *before* the acceptor is a member of anything, so an
 * organisation-match policy would break exactly the request the table exists to
 * serve; and a token-hash session variable would be a worse mechanism than the
 * token itself — it would put the credential into the database session, where
 * every statement on the connection could see it, to protect a row whose only
 * secret is that credential. Isolation here is the token and the
 * `organisation_id` predicate this controller and the locator apply.
 */
final class OrganisationInvitationStoreController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly InvitationService $invitations,
        private readonly OrganisationInvitationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreOrganisationInvitationRequest $request, string $organisation): JsonResponse
    {
        $tenant = $this->locator->contextOrganisation($organisation);
        $payload = $request->payload();

        $issued = $this->invitations->issue(
            $tenant,
            $payload['email'],
            $payload['role_code'],
            $this->currentUser($request),
            $this->branch($payload['branch_id']),
            $payload['message'],
        );

        // `$issued->token` is deliberately unread. See the class comment.
        return ApiResponse::data(
            ['invitation' => $this->presenter->invitation($issued->invitation)],
            status: 201,
        );
    }

    /**
     * The branch the invitation is scoped to, resolved inside the tenant scope.
     *
     * Read through the ordinary query rather than `withoutTenancy()`, so the
     * global organisation scope is what refuses another tenant's branch. The
     * service checks the same thing again and says so by name; this exists so
     * a cross-tenant identifier never becomes a readable row in the first
     * place.
     *
     * @throws ApiException
     */
    private function branch(?string $branchId): ?OrganisationBranch
    {
        if ($branchId === null) {
            return null;
        }

        $branch = OrganisationBranch::query()->whereKey($branchId)->first();

        if (! $branch instanceof OrganisationBranch) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That branch does not exist in this organisation.',
                ['fields' => ['branch_id' => ['That branch does not exist in this organisation.']]],
            );
        }

        return $branch;
    }
}
