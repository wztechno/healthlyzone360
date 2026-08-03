<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Presenters\OrganisationInvitationPresenter;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/invitations/{token}/accept — take up an offer of membership.
 *
 * **`auth` and `verified` only — no `org.context`, and that absence is the
 * entire point.** The acceptor is not a member of anything yet; requiring an
 * organisation context would mean requiring the membership this request exists
 * to create. They must be signed in, so acceptance is attributable to a real
 * identity, and email-verified, so the identity is reachable.
 *
 * ## Row-level security: recorded, not implemented
 *
 * `organisation_invitations` carries **no PostgreSQL policy**, and this
 * endpoint is why. The row is resolved by hashed token *before* the acceptor
 * belongs to the organisation, so an organisation-match policy would fail
 * closed on exactly the request it was meant to protect. The alternative —
 * publishing the token hash into a session variable so a policy could match on
 * it — would be strictly worse than the token itself: it would put the
 * credential onto the database connection, visible to every statement on it,
 * to protect a row whose only secret is that credential. Isolation here is the
 * token: 256 bits the platform generated, stored only as a SHA-256, single-use,
 * and expiring in days.
 *
 * ## Why the token is in the path
 *
 * Because the link in the email is what a person clicks, and a client that
 * received it as a path segment should not have to reshape it. The cost is
 * real and worth naming: path segments reach access logs, referrer headers and
 * browser history in a way request bodies do not. What makes it tolerable is
 * that the token is single-use and consumed here, short-lived, and useless
 * without an authenticated session — an intercepted one buys an attacker
 * nothing unless they are also signed in as somebody the invitation was never
 * for, and acceptance is recorded against whoever that is.
 *
 * ## Acceptance is a shell, and says so
 *
 * `InvitationService::accept()` validates the token, marks the row accepted,
 * and **stops there**. The membership write belongs to Organisations and
 * AccessControl and has not landed, so `membership_created` is `false` and
 * `membership` is `null` on every response this endpoint produces. Reporting
 * that plainly is the whole reason `AcceptedInvitation` carries the flag: a
 * response that quietly implied a provisioned member would let a client show
 * somebody a workspace they cannot enter. The keys are present rather than
 * omitted so the wire shape does not change when the write arrives.
 *
 * Every failure — wrong token, expired, revoked, already accepted — is the same
 * `404` with the same message. Distinguishing them would tell somebody holding
 * a guessed token that they guessed right.
 */
final class InvitationAcceptController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly InvitationService $invitations,
        private readonly OrganisationInvitationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $token): JsonResponse
    {
        $accepted = $this->invitations->accept($token, $this->currentUser($request));

        return ApiResponse::data([
            'invitation' => $this->presenter->invitation($accepted->invitation),
            'membership' => null,
            'membership_created' => $accepted->membershipCreated,
        ]);
    }
}
