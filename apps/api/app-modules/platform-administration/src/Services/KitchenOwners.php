<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\B2b\Services\InvitationService;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\PlatformAdministration\Mail\KitchenOwnerInvitationMessage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\Mail;

/**
 * Handing a kitchen to somebody, and taking it back.
 *
 * ## Inviting reuses B1's machinery whole
 *
 * `organisation_invitations`, `InvitationService::issue()`, the SHA-256 token,
 * the seven-day expiry, the partial unique index that makes re-inviting
 * supersede rather than duplicate — all of it already existed and all of it is
 * used unchanged. The role code is `organisation_owner`, which is a template
 * role every organisation on the platform shares, so nothing has to be created
 * for a brand-new kitchen before its owner can be invited.
 *
 * ## What PA1 adds is the email
 *
 * B1 generated the token and dropped it: `OrganisationInvitationStoreController`
 * says `$issued->token is deliberately unread`, because nothing had been built
 * to carry it. That is defensible for an invitation issued as a side effect of
 * provisioning, where the platform is already in conversation with the
 * applicant. It is not defensible here, where the whole action is "tell this
 * person they now run a kitchen". So the mail is sent from *this* service and
 * not from `issue()` — the B1 call sites keep their existing behaviour, and a
 * provisioning run does not start emailing people because the console learned
 * how to.
 *
 * ## Revoking may take the last owner, and says so
 *
 * The platform acts deliberately: a kitchen whose owner has left, or whose
 * owner is the reason it is being suspended, must be able to have that
 * membership ended before a replacement exists. Refusing would leave the
 * console unable to do the one thing it was opened to do.
 *
 * What it does instead is *report* it. `remaining_owners` comes back on the
 * response so the screen can say "this kitchen now has no owner" — a warning
 * the operator can act on, rather than a rule that acts for them.
 *
 * ## Ending a membership, not deleting one
 *
 * `MembershipStatus::Ended`, the same terminal state `RevokeBusinessAccess`
 * writes, and for the same reason: the row is the record that this person was
 * an owner, and the audit entry beside it is worth nothing if the thing it
 * refers to has been erased. Saving row-by-row rather than mass-updating is
 * also deliberate — `PermissionVersionObserver` fires on model events, and a
 * bulk write would leave the revoked owner's calculated permissions cached and
 * valid for another five minutes. The explicit `bumpVersion()` afterwards is
 * the same belt-and-braces B2 wrote for itself.
 *
 * Tokens are **not** deleted. A person who stops running one kitchen is not a
 * person who has stopped existing: they may shop on the platform, they may run
 * another kitchen, and signing them out of all of it is a punishment the
 * platform has not decided to hand out. The permission-version bump removes
 * this organisation from their context immediately, which is the actual
 * requirement.
 */
final readonly class KitchenOwners
{
    public const string OWNER_ROLE = 'organisation_owner';

    public function __construct(
        private InvitationService $invitations,
        private KitchenOverviewQuery $overview,
        private PermissionCache $permissions,
        private AuditRecorder $audit,
    ) {}

    /**
     * @return array{invitation: OrganisationInvitation, mailed: bool}
     *
     * @throws ApiException
     */
    public function invite(
        Organisation $kitchen,
        string $email,
        ?string $name,
        ?string $message,
        User $actor,
    ): array {
        $issued = $this->invitations->issue(
            $kitchen,
            $email,
            self::OWNER_ROLE,
            $actor,
            null,
            $message,
        );

        $mailed = $this->mail($kitchen, $issued->invitation->email, $name, $issued->token, $message);

        $this->audit->record(
            'platform.kitchen_owner_invited',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation',
            subjectId: (string) $kitchen->getKey(),
            metadata: [
                'slug' => $kitchen->slug,
                'invitation_id' => (string) $issued->invitation->getKey(),
                'role' => self::OWNER_ROLE,
                'mailed' => $mailed,
            ],
        );

        return ['invitation' => $issued->invitation, 'mailed' => $mailed];
    }

    /**
     * @return array{membership: OrganisationMembership, remaining_owners: int}
     *
     * @throws ApiException
     */
    public function revoke(Organisation $kitchen, string $membershipId, User $actor): array
    {
        $membership = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->whereKey(trim($membershipId))
            ->first();

        if (! $membership instanceof OrganisationMembership) {
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'No membership with that identifier belongs to this kitchen.',
            );
        }

        if ($membership->status === MembershipStatus::Ended) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This membership has already ended.',
                ['status' => $membership->status->value],
            );
        }

        $previous = $membership->status;

        $membership->status = MembershipStatus::Ended;
        $membership->lock_version = $membership->lock_version + 1;
        $membership->save();

        $this->permissions->bumpVersion((string) $kitchen->getKey());

        $remaining = count($this->overview->ownersOf($kitchen));

        $this->audit->record(
            'platform.kitchen_owner_revoked',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation_membership',
            subjectId: (string) $membership->getKey(),
            metadata: [
                'organisation_id' => (string) $kitchen->getKey(),
                'slug' => $kitchen->slug,
                'member_user_id' => (string) $membership->user_id,
                'from_status' => $previous->value,
                'to_status' => MembershipStatus::Ended->value,
                'remaining_owners' => $remaining,
            ],
        );

        return ['membership' => $membership, 'remaining_owners' => $remaining];
    }

    /**
     * Send the invitation, and never let a mail failure lose the invitation.
     *
     * The row is already written and the token already exists; a transport
     * error means the operator has to re-invite, which supersedes cleanly. An
     * exception here would surface as a 500 on a request that succeeded, and
     * the operator would try again and wonder why the list had two entries.
     */
    private function mail(
        Organisation $kitchen,
        string $email,
        ?string $name,
        string $token,
        ?string $message,
    ): bool {
        try {
            Mail::to($email)->send(new KitchenOwnerInvitationMessage(
                kitchenName: $kitchen->name,
                recipientName: $name === null || trim($name) === '' ? null : trim($name),
                acceptUrl: $this->acceptUrl($token),
                message: $message === null || trim($message) === '' ? null : trim($message),
                locale: $kitchen->default_language_code,
            ));

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * The link in the email.
     *
     * It points at the universal app, not the API. The person clicking it has
     * to be signed in for acceptance to attribute to anybody, so the landing
     * has to be a screen that can sign them in first and then `POST` the
     * token — which is exactly what `/invitations/{token}` in the app does.
     */
    private function acceptUrl(string $token): string
    {
        $base = rtrim((string) config('app.frontend_url'), '/');

        return $base.'/invitations/'.rawurlencode($token);
    }
}
