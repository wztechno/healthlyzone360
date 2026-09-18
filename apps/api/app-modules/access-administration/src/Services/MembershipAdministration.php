<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Illuminate\Support\Facades\DB;

/**
 * The lifecycle of somebody's place in a kitchen: where they work, whether
 * they may work, and when they stop.
 *
 * ## Verbs, never a status field
 *
 * There is no `setStatus()`. `suspend()` and `reactivate()` are the reversible
 * pair; `end()` is terminal. A single call taking a string would let a console
 * ship a dropdown containing `ended` beside `active`, which makes the one
 * irreversible act look like a choice among four — and would need a state
 * machine in a validator to stop it. `PlatformAdminRepository` states the rule
 * for organisations; a person's membership deserves it at least as much.
 *
 * Scope is the exception, and deliberately so: which branch somebody works at
 * is an ordinary attribute that moves both ways, not a lifecycle event, so it
 * is a `PATCH`.
 *
 * ## The caller cannot do any of this to themselves
 *
 * PA1 lets the platform revoke a kitchen's last owner because it acts from
 * *outside*: whatever it breaks, it can still reach in and fix. A tenant
 * administrator is inside the room they would be locking, and `end()` on their
 * own membership is not recoverable from any screen this console has. So it is
 * refused — the only refusal of its kind here.
 *
 * Ending the last **other** administrator is permitted, and merely counted.
 * That asymmetry is the whole design: a console that refused the thing an
 * operator opened it to do would be a control that had made itself unusable,
 * so the API reports the consequence and the screen warns.
 */
final readonly class MembershipAdministration
{
    public function __construct(private PermissionCache $cache) {}

    /**
     * Move somebody between branch-scoped and organisation-wide access.
     *
     * A null `branch_id` means organisation-wide, which is why this takes a
     * nullable branch rather than a flag beside an identifier: "organisation-
     * wide, branch A" is not a thing, and a shape that could express it would
     * eventually be asked to mean something.
     *
     * @throws ApiException
     */
    public function setScope(
        OrganisationMembership $membership,
        ?OrganisationBranch $branch,
        int $expectedLockVersion,
    ): OrganisationMembership {
        if ($branch !== null && (string) $branch->organisation_id !== (string) $membership->organisation_id) {
            // Unreachable through the controller, which resolves the branch
            // inside the tenant scope. Stated anyway, because a service that
            // trusts its caller's scoping is a service that writes a
            // cross-tenant row the day a second caller appears.
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That branch does not exist in this organisation.',
                ['fields' => ['branch_id' => ['That branch does not exist in this organisation.']]],
            );
        }

        return $this->compareAndSwap($membership, [
            'branch_id' => $branch?->getKey(),
        ], $expectedLockVersion);
    }

    /**
     * Stop somebody signing in without ending their record.
     *
     * @throws ApiException
     */
    public function suspend(
        OrganisationMembership $membership,
        int $expectedLockVersion,
        ?string $actorMembershipId,
    ): OrganisationMembership {
        $this->assertNotSelf($membership, $actorMembershipId, 'suspend_own_membership');

        if ($membership->status !== MembershipStatus::Active && $membership->status !== MembershipStatus::Invited) {
            // `ended` is terminal and `suspended` is already the destination.
            // Neither is a race the caller lost, so it is a conflict rather
            // than a stale version — and an already-suspended membership
            // answering 200 would let a console report an action it did not
            // take.
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'Only an active or invited membership can be suspended.',
                ['status' => $membership->status->value],
            );
        }

        return $this->compareAndSwap($membership, [
            'status' => MembershipStatus::Suspended,
        ], $expectedLockVersion);
    }

    /**
     * @throws ApiException
     */
    public function reactivate(OrganisationMembership $membership, int $expectedLockVersion): OrganisationMembership
    {
        if ($membership->status !== MembershipStatus::Suspended) {
            // `ended` is terminal — a person who has left and comes back is a
            // new invitation, not an undo — and `active` is already the
            // destination. Neither is a race the caller lost, so it is a
            // conflict rather than a stale version.
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'Only a suspended membership can be reactivated.',
                ['status' => $membership->status->value],
            );
        }

        return $this->compareAndSwap($membership, [
            'status' => MembershipStatus::Active,
        ], $expectedLockVersion);
    }

    /**
     * End somebody's place here.
     *
     * The row survives, stamped rather than removed. Who used to have access is
     * exactly what an access review reads, and orders, audit rows and recipe
     * versions point at the person behind it. It is the same posture
     * `organisation_invitations` takes to a revocation next door.
     *
     * @throws ApiException
     */
    public function end(
        OrganisationMembership $membership,
        int $expectedLockVersion,
        ?string $actorMembershipId,
    ): OrganisationMembership {
        $this->assertNotSelf($membership, $actorMembershipId, 'end_own_membership');

        if ($membership->status === MembershipStatus::Ended) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This membership has already ended.',
                ['status' => $membership->status->value],
            );
        }

        return $this->compareAndSwap($membership, [
            'status' => MembershipStatus::Ended,
        ], $expectedLockVersion);
    }

    /**
     * @throws ApiException
     */
    private function assertNotSelf(OrganisationMembership $membership, ?string $actorMembershipId, string $reason): void
    {
        if ($actorMembershipId !== null && (string) $membership->getKey() === $actorMembershipId) {
            throw new ApiException(
                ErrorCode::AccessSelfLockout,
                'You cannot remove your own access. Ask another administrator to do it.',
                ['reason' => $reason],
            );
        }
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws ApiException
     */
    private function compareAndSwap(
        OrganisationMembership $membership,
        array $changes,
        int $expectedLockVersion,
    ): OrganisationMembership {
        return DB::transaction(function () use ($membership, $changes, $expectedLockVersion): OrganisationMembership {
            $affected = OrganisationMembership::query()
                ->whereKey($membership->getKey())
                ->where('lock_version', $expectedLockVersion)
                ->update($changes + [
                    'lock_version' => $expectedLockVersion + 1,
                    'updated_at' => now(),
                ]);

            if ($affected === 0) {
                $current = OrganisationMembership::query()->whereKey($membership->getKey())->value('lock_version');

                throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
            }

            // Status and branch are both read by `PermissionChecker` — step 2
            // rejects an inactive membership, step 3 a branch outside scope —
            // so every change here invalidates a cached permission set that is
            // otherwise good for another five minutes.
            $this->cache->bumpVersion((string) $membership->organisation_id);

            $membership->refresh();

            return $membership;
        });
    }
}
