<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Offers of membership: making one, withdrawing one, and finding the one a
 * token belongs to.
 *
 * ## The token
 *
 * `issue()` returns an `IssuedInvitation` carrying the plaintext token **once**
 * and never again. Only its SHA-256 reaches the database, so:
 *
 *  * a database read cannot be turned into an accepted invitation;
 *  * a backup, a replica or a log line cannot either;
 *  * and the platform genuinely cannot resend the original — re-inviting
 *    issues a new token and revokes the old, which is the honest behaviour and
 *    also the safe one.
 *
 * SHA-256 rather than bcrypt/argon: this is 256 bits the platform generated,
 * not a human-chosen secret, so there is nothing for a work factor to slow
 * down and the accept path needs a single indexed lookup rather than a scan
 * comparing every row.
 *
 * ## Acceptance is a shell
 *
 * `accept()` validates the token, the expiry and the outcome columns, marks
 * the row accepted and **stops there**. What it does not do is create the
 * membership — that write belongs to Organisations and AccessControl, in the
 * same idempotent provisioning transaction that creates the organisation
 * itself, and the integrator wave owns it (see the module docblock). Splitting
 * it this way keeps this module's dependency edges honest: B1 can prove an
 * invitation is valid without B1 being able to grant access.
 *
 * The shell is marked rather than silent — `acceptedWithoutMembership()` on
 * the result says exactly what did and did not happen, so nothing downstream
 * can mistake a validated token for a provisioned user.
 */
final readonly class InvitationService
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * Issue an invitation, replacing any outstanding offer to the same
     * address.
     *
     * The replacement is the point: two live tokens for one seat means
     * revoking one achieves nothing, and the partial unique index would refuse
     * the second anyway. Better to make the intent explicit than to surface a
     * constraint violation.
     *
     * @throws ApiException
     */
    public function issue(
        Organisation $organisation,
        string $email,
        string $roleCode,
        User $actor,
        ?OrganisationBranch $branch = null,
        ?string $message = null,
    ): IssuedInvitation {
        $address = trim($email);
        $normalised = mb_strtolower($address);
        $code = trim($roleCode);

        if ($address === '' || ! filter_var($address, FILTER_VALIDATE_EMAIL)) {
            throw $this->invalid('email', 'An invitation needs a valid email address to go to.');
        }

        if ($code === '') {
            throw $this->invalid('role_code', 'An invitation has to say what the person is being invited to do.');
        }

        if ($branch instanceof OrganisationBranch && (string) $branch->organisation_id !== (string) $organisation->getKey()) {
            throw $this->invalid('branch_id', 'That branch belongs to a different organisation.');
        }

        $token = Str::random($this->tokenLength());
        $hash = $this->hash($token);
        $expiresAt = CarbonImmutable::now()->addDays($this->ttlDays());

        $invitation = DB::transaction(function () use ($organisation, $branch, $address, $normalised, $code, $hash, $expiresAt, $actor, $message): OrganisationInvitation {
            $superseded = OrganisationInvitation::query()
                ->where('organisation_id', $organisation->getKey())
                ->where('email_normalised', $normalised)
                ->whereNull('accepted_at')
                ->whereNull('revoked_at')
                ->update([
                    'revoked_at' => now(),
                    'revoked_by' => (string) $actor->getKey(),
                    'updated_at' => now(),
                ]);

            $invitation = new OrganisationInvitation;
            $invitation->organisation_id = (string) $organisation->getKey();
            $invitation->branch_id = $branch?->getKey() === null ? null : (string) $branch->getKey();
            $invitation->email = $address;
            $invitation->email_normalised = $normalised;
            $invitation->role_code = $code;
            $invitation->token_hash = $hash;
            $invitation->expires_at = $expiresAt;
            $invitation->invited_by = (string) $actor->getKey();
            $invitation->message = $message === null || trim($message) === '' ? null : trim($message);
            $invitation->save();

            $invitation->setAttribute('superseded_count', $superseded);

            return $invitation;
        });

        $this->audit->record(
            'b2b.organisation_invitation_issued',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation_invitation',
            subjectId: (string) $invitation->getKey(),
            metadata: [
                // The role is named as `role`, not `role_code`: the audit
                // recorder's redaction list matches `code` as a substring, so
                // a key ending in `_code` would be blanked (OQ-036, R-019).
                'role' => $invitation->role_code,
                'organisation_id' => (string) $organisation->getKey(),
                'branch_id' => $invitation->branch_id,
                'expires_at' => $expiresAt->toIso8601String(),
                'superseded_count' => (int) $invitation->getAttribute('superseded_count'),
            ],
        );

        return new IssuedInvitation($invitation, $token);
    }

    /**
     * The live invitation a token belongs to, or null.
     *
     * Null for every failure — wrong token, expired, revoked, already
     * accepted — deliberately without saying which. The caller shows one
     * message, because distinguishing "this token is wrong" from "this token
     * expired" tells somebody holding a guessed token that they guessed
     * right.
     */
    public function findLiveByToken(string $token): ?OrganisationInvitation
    {
        $invitation = OrganisationInvitation::query()
            ->where('token_hash', $this->hash(trim($token)))
            ->first();

        if (! $invitation instanceof OrganisationInvitation) {
            return null;
        }

        return $invitation->isLive() ? $invitation : null;
    }

    /**
     * Mark an invitation accepted — **and only that** (see the class comment).
     *
     * @throws ApiException
     */
    public function accept(string $token, User $acceptor): AcceptedInvitation
    {
        $invitation = $this->findLiveByToken($token);

        if (! $invitation instanceof OrganisationInvitation) {
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'This invitation is no longer valid. Ask for a new one.',
            );
        }

        $invitation->accepted_at = CarbonImmutable::now();
        $invitation->accepted_by_user_id = (string) $acceptor->getKey();
        $invitation->save();

        $this->audit->record(
            'b2b.organisation_invitation_accepted',
            actorUserId: (string) $acceptor->getKey(),
            subjectType: 'organisation_invitation',
            subjectId: (string) $invitation->getKey(),
            metadata: [
                'organisation_id' => $invitation->organisation_id,
                'role' => $invitation->role_code,
                'membership_created' => false,
            ],
        );

        return new AcceptedInvitation($invitation, membershipCreated: false);
    }

    /**
     * Withdraw an outstanding offer.
     *
     * @throws ApiException
     */
    public function revoke(OrganisationInvitation $invitation, User $actor): OrganisationInvitation
    {
        if ($invitation->accepted_at !== null) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This invitation has already been accepted. Remove the membership instead.',
            );
        }

        if ($invitation->revoked_at !== null) {
            return $invitation;
        }

        $invitation->revoked_at = CarbonImmutable::now();
        $invitation->revoked_by = (string) $actor->getKey();
        $invitation->save();

        $this->audit->record(
            'b2b.organisation_invitation_revoked',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation_invitation',
            subjectId: (string) $invitation->getKey(),
            metadata: [
                'organisation_id' => $invitation->organisation_id,
                'role' => $invitation->role_code,
            ],
        );

        return $invitation;
    }

    /**
     * Delete invitations that expired long enough ago to have stopped being
     * interesting.
     *
     * Accepted and revoked rows are kept: they are the trail of who was let
     * in and who was turned away. An expired-and-never-used offer is neither,
     * and it holds an email address for no remaining purpose.
     *
     * @return int how many rows were removed
     */
    public function purgeExpired(int $graceDays = 30, ?CarbonImmutable $now = null): int
    {
        $cutoff = ($now ?? CarbonImmutable::now())->subDays($graceDays);

        return OrganisationInvitation::query()
            ->whereNull('accepted_at')
            ->whereNull('revoked_at')
            ->where('expires_at', '<=', $cutoff)
            ->delete();
    }

    /** The digest a token is looked up by. The token itself is never stored. */
    private function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private function ttlDays(): int
    {
        return (int) config('b2b.invitations.ttl_days', 7);
    }

    private function tokenLength(): int
    {
        // `Str::random` returns that many base64-ish characters, so the
        // configured byte count is the entropy floor rather than the length.
        return max(32, (int) config('b2b.invitations.token_bytes', 32));
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
