<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\OrganisationInvitation;

/**
 * The wire shape of an offer of membership.
 *
 * **There is no `token` field and there never may be.** `IssuedInvitation`
 * carries the plaintext exactly once, to the mail that delivers it; only its
 * SHA-256 is stored, and `token_hash` is hidden on the model. A presenter is a
 * hand-written allowlist, so the only way either value could reach a response
 * body is if somebody typed it into this file — which is the property that
 * makes "the platform cannot resend the original invitation" true rather than
 * merely intended.
 *
 * **`status` is derived here, not stored.** The row carries `accepted_at`,
 * `revoked_at` and `expires_at`, and the fourth state — live — is the absence
 * of the other three plus a clock. A `status` column would be a copy that has
 * to be kept in step with time, and expiry would be the first thing to drift.
 * Deriving it at the boundary means the list and the row can never disagree.
 *
 * The `email` is served in full to organisation members reading their own
 * invitation list, because "who did we invite" is unanswerable otherwise and
 * the reader is already inside the organisation the invitation belongs to.
 */
final class OrganisationInvitationPresenter
{
    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     branch_id: string|null,
     *     email: string,
     *     role_code: string,
     *     status: string,
     *     message: string|null,
     *     expires_at: string,
     *     accepted_at: string|null,
     *     accepted_by_user_id: string|null,
     *     revoked_at: string|null,
     *     revoked_by: string|null,
     *     invited_by: string|null,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function invitation(OrganisationInvitation $invitation): array
    {
        return [
            'id' => (string) $invitation->getKey(),
            'organisation_id' => $invitation->organisation_id,
            'branch_id' => $invitation->branch_id,
            'email' => $invitation->email,
            'role_code' => $invitation->role_code,
            'status' => $this->status($invitation),
            'message' => $invitation->message,
            'expires_at' => $invitation->expires_at->toIso8601String(),
            'accepted_at' => $invitation->accepted_at?->toIso8601String(),
            'accepted_by_user_id' => $invitation->accepted_by_user_id,
            'revoked_at' => $invitation->revoked_at?->toIso8601String(),
            'revoked_by' => $invitation->revoked_by,
            'invited_by' => $invitation->invited_by,
            'created_at' => $invitation->created_at?->toIso8601String(),
            'updated_at' => $invitation->updated_at?->toIso8601String(),
        ];
    }

    private function status(OrganisationInvitation $invitation): string
    {
        return match (true) {
            $invitation->accepted_at !== null => 'accepted',
            $invitation->revoked_at !== null => 'revoked',
            $invitation->hasExpired() => 'expired',
            default => 'live',
        };
    }
}
