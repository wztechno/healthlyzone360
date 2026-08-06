<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Presenters\PublicInvitationPresenter;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/invitations/{token} — what the person holding the link is
 * looking at, before they decide anything.
 *
 * ## Anonymous, because the token *is* the capability
 *
 * The mailed link lands somebody on a screen that has to render before it can
 * ask them to sign in — "join Cedar Kitchen as an owner" is the reason to sign
 * in, and demanding the sign-in first would be asking a person to authenticate
 * into something they have not been told the name of. So there is no
 * `auth:sanctum` here, no `verified`, and no `org.context`: the acceptor is a
 * member of nothing, which is the whole reason the invitation exists.
 *
 * Acceptance is a different question and keeps its own gates —
 * `InvitationAcceptController` still requires a signed-in, email-verified
 * caller whose own address matches. This endpoint reads; it changes nothing,
 * consumes nothing, and a token is no closer to being spent for having been
 * looked at.
 *
 * ## What it will not say
 *
 * Only the invitation's own facts, and the address masked. See
 * `PublicInvitationPresenter` for what each field had to earn. In particular
 * there is no organisation identifier, no branch, no inviter and no message:
 * an unauthenticated endpoint that served them would answer questions about a
 * tenant to anybody holding one link into it.
 *
 * ## Enumeration
 *
 * A token this platform never issued is `404`. So is one whose invitation has
 * been purged — `InvitationService::purgeExpired()` deletes expired,
 * never-used offers after a grace period, and the two cases are one response
 * with one message. A *known* token does report its state, including the
 * terminal ones, and that is a deliberate line: the screen exists to explain
 * why a link no longer works, and a caller who reaches that explanation is
 * holding 256 bits the platform generated rather than a guess.
 *
 * The `invitation-lookup` limiter is what makes "rather than a guess" true —
 * twenty a minute per IP, an order of magnitude tighter than the `api` group's
 * sixty, because this is the one anonymous endpoint where a wrong answer is
 * still an answer.
 */
final class InvitationShowController
{
    public function __construct(
        private readonly InvitationService $invitations,
        private readonly PublicInvitationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $token): JsonResponse
    {
        $invitation = $this->invitations->findByToken($token);

        if (! $invitation instanceof OrganisationInvitation) {
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'This invitation is no longer valid. Ask for a new one.',
            );
        }

        $organisation = Organisation::query()->whereKey($invitation->organisation_id)->first();

        // An invitation whose organisation has been removed is an invitation to
        // nothing. The same 404 rather than a half-rendered screen: there is no
        // workspace left to join, and naming one that is gone would be worse
        // than saying the link is dead.
        if (! $organisation instanceof Organisation) {
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'This invitation is no longer valid. Ask for a new one.',
            );
        }

        return ApiResponse::data([
            'invitation' => $this->presenter->invitation($invitation, $organisation),
        ]);
    }
}
