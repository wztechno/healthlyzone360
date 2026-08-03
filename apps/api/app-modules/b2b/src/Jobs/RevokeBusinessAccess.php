<?php

declare(strict_types=1);

namespace Healthy360\B2b\Jobs;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bOffboarding;
use Healthy360\B2b\Services\OffboardingService;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Taking a corporate customer's access away.
 *
 * The one step of an offboarding that can partially fail, which is why it has
 * a status of its own and why it is a queued job rather than part of a
 * request. Five things happen, in this order, and the order is the design.
 *
 * ## 1. Every membership ends, and each one is audited
 *
 * A row at a time, not a mass `update()`. Two reasons, and both are load
 * bearing. The audit trail has to name each person whose access was removed —
 * "we ended 14 memberships" is a count, not a record, and the question asked
 * afterwards is always about one person. And `PermissionVersionObserver` fires
 * on model events, which a mass update does not raise; a bulk write would
 * leave every affected user's calculated permissions cached and valid for the
 * next five minutes, which is five minutes of access to an organisation that
 * has been closed.
 *
 * ## 2. The permission version is bumped anyway
 *
 * Explicitly, once, after the loop. The observer already bumped it per
 * membership, so this is belt and braces — and it is cheap insurance against
 * the observer being unregistered, the loop finding nothing, or a future
 * refactor reaching for a bulk write after all.
 *
 * ## 3. Tokens are deleted for *some* users only
 *
 * **This is the rule the phase exists to get right.** A person's API tokens
 * are not the organisation's property. Deleting every token held by everybody
 * who was a member would sign out a contractor from the other three companies
 * they work with, and would sign out a person who also shops on the platform
 * as a consumer — losing them their own cart and their own order history
 * because their employer left.
 *
 * So tokens go only for a user for whom **both** are true:
 *
 *  - this organisation was their *sole* membership — no other membership row
 *    exists for them, in any status, anywhere; and
 *  - they hold no customer account of their own.
 *
 * Everybody else keeps their tokens and simply loses this organisation from
 * their context, which the permission-version bump makes immediate. The
 * count is recorded on the offboarding row so the decision is visible.
 *
 * ## 4. The organisation closes
 *
 * `closed`, not `suspended` — see the migration that widened the CHECK for why
 * those must not be the same word.
 *
 * ## 5. The agreement terminates
 *
 * Through `AgreementService`'s own vocabulary (`terminated`), because the
 * agreement's state machine belongs to the agreement.
 *
 * ## Then archiving begins
 *
 * The job hands straight on to `OffboardingService::archive()`. That is not a
 * cascade of the kind the service refuses to do elsewhere: revocation and the
 * personal-data purge are one operator decision — "wind this up" — and leaving
 * an organisation revoked-but-not-purged pending a second click is how
 * personal data survives an offboarding indefinitely. If the purge throws, the
 * row sits in `archiving` and the job retries into a step that is idempotent
 * by construction.
 */
final class RevokeBusinessAccess implements ShouldQueue
{
    use Queueable;

    public function __construct(
        private readonly string $offboardingId,
        private readonly string $actorUserId,
    ) {
        $this->onQueue('maintenance');
    }

    public function handle(
        OffboardingService $offboardings,
        PermissionCache $permissions,
        AuditRecorder $audit,
    ): void {
        $offboarding = B2bOffboarding::query()->whereKey($this->offboardingId)->first();
        $actor = User::query()->whereKey($this->actorUserId)->first();

        if (! $offboarding instanceof B2bOffboarding || ! $actor instanceof User) {
            return;
        }

        if ($offboarding->status !== OffboardingStatus::Revoking) {
            // Already carried past this step. A retry after a partial failure
            // re-enters at `archiving`, which is idempotent, so there is
            // nothing to undo and nothing to repeat.
            return;
        }

        $organisationId = $offboarding->organisation_id;

        $ended = $this->endMemberships($organisationId, $actor, $audit);
        $permissions->bumpVersion($organisationId);
        $tokensDeleted = $this->deleteTokensOfSoleMembers($ended['user_ids'], $organisationId, $actor, $audit);
        $this->closeOrganisation($organisationId, $actor, $audit);
        $this->terminateAgreement($offboarding, $actor, $audit);

        $offboarding->memberships_revoked = $ended['count'];
        $offboarding->tokens_deleted = $tokensDeleted;
        $offboarding->revocation_completed_at = CarbonImmutable::now();
        $offboarding->save();

        $audit->record(
            'b2b.offboarding_access_revoked',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_offboarding',
            subjectId: (string) $offboarding->getKey(),
            metadata: [
                'organisation_id' => $organisationId,
                'memberships_revoked' => $ended['count'],
                'tokens_deleted' => $tokensDeleted,
                'shared_users_retained' => count($ended['user_ids']) - $tokensDeleted,
            ],
        );

        $offboardings->archive($offboarding, $actor);
    }

    /**
     * End every membership in the organisation, one row at a time.
     *
     * `invited` rows end too. A pending invitation into an organisation that
     * is closing is an open door nobody is watching, and leaving it as
     * `invited` would let somebody accept their way into a closed tenant.
     *
     * @return array{count: int, user_ids: list<string>}
     */
    private function endMemberships(string $organisationId, User $actor, AuditRecorder $audit): array
    {
        $memberships = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('status', [
                MembershipStatus::Active->value,
                MembershipStatus::Invited->value,
                MembershipStatus::Suspended->value,
            ])
            ->get();

        $userIds = [];

        foreach ($memberships as $membership) {
            $previous = $membership->status;

            $membership->status = MembershipStatus::Ended;
            $membership->lock_version = $membership->lock_version + 1;
            $membership->save();

            $userIds[] = (string) $membership->user_id;

            $audit->record(
                'b2b.offboarding_membership_ended',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'organisation_membership',
                subjectId: (string) $membership->getKey(),
                metadata: [
                    'organisation_id' => $organisationId,
                    'member_user_id' => (string) $membership->user_id,
                    'from_status' => $previous->value,
                    'to_status' => MembershipStatus::Ended->value,
                ],
            );
        }

        return ['count' => $memberships->count(), 'user_ids' => array_values(array_unique($userIds))];
    }

    /**
     * Delete the tokens of the people for whom this organisation was
     * everything, and of nobody else.
     *
     * The membership test looks at rows in **any** status, including the ones
     * this job just ended: somebody who left a previous employer through this
     * same process still has an `ended` row there, and treating that as "no
     * other membership" would delete the tokens of a person who is mid-way
     * through joining somewhere new. The question is "has this platform ever
     * known them anywhere else", and an ended membership is an answer.
     *
     * @param  list<string>  $userIds
     */
    private function deleteTokensOfSoleMembers(array $userIds, string $organisationId, User $actor, AuditRecorder $audit): int
    {
        $deleted = 0;

        foreach ($userIds as $userId) {
            $elsewhere = OrganisationMembership::withoutTenancy()
                ->where('user_id', $userId)
                ->where('organisation_id', '<>', $organisationId)
                ->exists();

            if ($elsewhere) {
                continue;
            }

            // `CustomerAccount` is deliberately not organisation-scoped, so a
            // plain query is the unscoped one — see the model for why an
            // ambient org scope would hide a consumer's own account.
            $hasCustomerAccount = CustomerAccount::query()
                ->where('user_id', $userId)
                ->exists();

            if ($hasCustomerAccount) {
                continue;
            }

            $removed = PersonalAccessToken::query()
                ->where('tokenable_type', User::class)
                ->where('tokenable_id', $userId)
                ->delete();

            $audit->record(
                'b2b.offboarding_tokens_deleted',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'user',
                subjectId: $userId,
                metadata: [
                    'tokens_removed' => $removed,
                    'sole_membership' => true,
                    'holds_customer_account' => false,
                ],
            );

            $deleted++;
        }

        return $deleted;
    }

    private function closeOrganisation(string $organisationId, User $actor, AuditRecorder $audit): void
    {
        $organisation = Organisation::query()->whereKey($organisationId)->first();

        if (! $organisation instanceof Organisation || $organisation->status === OrganisationStatus::Closed) {
            return;
        }

        $previous = $organisation->status;
        $organisation->status = OrganisationStatus::Closed;
        $organisation->lock_version = $organisation->lock_version + 1;
        $organisation->save();

        $audit->record(
            'b2b.offboarding_organisation_closed',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'organisation',
            subjectId: $organisationId,
            metadata: [
                'from_status' => $previous->value,
                'to_status' => OrganisationStatus::Closed->value,
            ],
        );
    }

    private function terminateAgreement(B2bOffboarding $offboarding, User $actor, AuditRecorder $audit): void
    {
        $agreement = $offboarding->agreement;

        if (! $agreement instanceof B2bAgreement || $agreement->status === AgreementStatus::Terminated) {
            return;
        }

        if (! $agreement->status->canTransitionTo(AgreementStatus::Terminated)) {
            // Recorded rather than thrown. An agreement that had already been
            // suspended into a state the machine will not carry forward must
            // not strand a revocation that has already removed everybody's
            // access — the access is gone either way, and the discrepancy is
            // worth seeing.
            Log::warning('An offboarding could not terminate its agreement.', [
                'b2b_offboarding_id' => (string) $offboarding->getKey(),
                'agreement_status' => $agreement->status->value,
            ]);

            return;
        }

        $previous = $agreement->status;
        $agreement->status = AgreementStatus::Terminated;
        $agreement->terminated_at = CarbonImmutable::now();
        $agreement->termination_reason = mb_substr('offboarding_'.($offboarding->trigger->value ?? 'unspecified'), 0, 40);
        $agreement->updated_by = (string) $actor->getKey();
        $agreement->lock_version = $agreement->lock_version + 1;
        $agreement->save();

        $audit->record(
            'b2b.offboarding_agreement_terminated',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_agreement',
            subjectId: (string) $agreement->getKey(),
            metadata: [
                'b2b_offboarding_id' => (string) $offboarding->getKey(),
                'from_status' => $previous->value,
                'to_status' => AgreementStatus::Terminated->value,
                'version' => $agreement->version,
            ],
        );
    }
}
