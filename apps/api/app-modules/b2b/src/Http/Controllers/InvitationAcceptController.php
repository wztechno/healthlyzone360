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
 * ## Acceptance now grants the membership
 *
 * B1 shipped this as a shell: the row was stamped and nothing else happened,
 * because the membership write belongs to Organisations and AccessControl and
 * B2B cannot call across that edge. PA1 published
 * `InvitationMembershipGranter` and bound it, so `membership_created` is now
 * `true` on a normal acceptance and `membership` carries the identifier. The
 * keys were present all along precisely so the wire shape would not have to
 * change when the write arrived — and both still report `false`/`null` when
 * nothing is bound, which is the point of reporting them at all.
 *
 * Every failure — wrong token, expired, revoked, already accepted — is the same
 * `404` with the same message. Distinguishing them would tell somebody holding
 * a guessed token that they guessed right. The one exception is a token
 * offered by the wrong person, which answers `403`: the caller already holds a
 * valid token, so there is nothing left to confirm, and "sign in as the person
 * this was sent to" is the only useful thing to say.
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
            'membership' => $accepted->membershipId === null ? null : ['id' => $accepted->membershipId],
            'membership_created' => $accepted->membershipCreated,
        ]);
    }
}
