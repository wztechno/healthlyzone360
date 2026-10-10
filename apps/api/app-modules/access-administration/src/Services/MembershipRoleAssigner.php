<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Illuminate\Support\Facades\DB;

/**
 * Replacing the set of roles a membership holds.
 *
 * ## A replace, not a pair of add/remove endpoints
 *
 * `membership_roles` is a set with `unique(membership_id, role_id)`, and the
 * thing an administrator actually decides is "this person holds exactly these
 * roles". Expressed as add and remove, that decision becomes three requests
 * with two intermediate states — one of which is "holds nothing", and another
 * "holds both the old and the new". On a permission table, intermediate states
 * are not a tidiness problem: a request that fails halfway leaves somebody with
 * authority nobody granted them.
 *
 * Replace-whole-set is also the house idiom already (`setRecipeLines`,
 * `replacePlanMenu`, `replaceSupplierContacts`), and it is the only shape that
 * can carry `starts_at`/`expires_at` without a second endpoint for the bounds.
 *
 * ## The time bounds are honoured, and the lock-out guard ignores them
 *
 * `membership_roles` has carried `starts_at`/`expires_at` since the foundation
 * and nothing has ever written them. This is what writes them: a role that
 * begins on Monday, a cover arrangement that ends on Friday.
 *
 * {@see AccessAdministrationQuery::codesForRoleSet()} deliberately does **not**
 * apply them when the self-lockout guard asks its question, and the mirror case
 * is why: a guard that counted only currently-effective roles would happily let
 * an administrator schedule their own to expire tonight. That is the lock-out
 * the guard exists to prevent, arriving on a timer.
 *
 * ## The cache bump is explicit, and it is the only way the change reaches
 * the other person
 *
 * `PermissionVersionObserver` watches `MembershipRole`, so the ordinary case is
 * covered. The bulk delete below is not an ordinary case: it fires no model
 * events, so a role withdrawn this way would stay in the other person's cached
 * permission set — valid for another five minutes — which on this surface means
 * an authority somebody believes they revoked still working. `KitchenOwners`
 * writes the same belt-and-braces bump for the same reason.
 */
final readonly class MembershipRoleAssigner
{
    public function __construct(
        private AccessAdministrationQuery $query,
        private GrantBoundary $boundary,
        private PermissionCache $cache,
    ) {}

    /**
     * @param  list<array{role_id: string, starts_at: ?string, expires_at: ?string}>  $assignments
     * @param  list<string>  $actorCodes
     *
     * @throws ApiException
     */
    public function replace(
        OrganisationMembership $membership,
        array $assignments,
        int $expectedLockVersion,
        User $actor,
        ?string $actorMembershipId,
        array $actorCodes,
    ): void {
        $roleIds = array_values(array_unique(array_column($assignments, 'role_id')));

        $this->assertRolesAreAssignable($membership, $roleIds);
        $this->boundary->assertMayGrant($this->query->codesForRoleSet($roleIds), $actor, $actorCodes);
        $this->assertActorKeepsTheKeys($membership, $roleIds, $actorMembershipId);

        DB::transaction(function () use ($membership, $assignments, $roleIds, $expectedLockVersion, $actor): void {
            // The membership's own version guards the whole replacement, even
            // though none of its columns change. Two administrators re-roling
            // one person is exactly the race worth detecting, and the roles
            // live in a child table with no version of their own to compare.
            $this->bumpMembership($membership, $expectedLockVersion);

            foreach ($assignments as $assignment) {
                MembershipRole::withoutTenancy()->updateOrCreate(
                    ['membership_id' => $membership->getKey(), 'role_id' => $assignment['role_id']],
                    [
                        'organisation_id' => $membership->organisation_id,
                        'starts_at' => $assignment['starts_at'],
                        'expires_at' => $assignment['expires_at'],
                        'created_by' => $actor->getKey(),
                    ],
                );
            }

            $withdrawn = MembershipRole::withoutTenancy()
                ->where('membership_id', $membership->getKey())
                ->when($roleIds !== [], static fn ($query) => $query->whereNotIn('role_id', $roleIds));

            $withdrawn->delete();

            $this->cache->bumpVersion((string) $membership->organisation_id);
        });
    }

    /**
     * Every named role must be one this organisation may assign — its own, or a
     * platform template.
     *
     * Resolved through `Role::query()` rather than `withoutTenancy()`, so the
     * global scope is what refuses another tenant's role and a cross-tenant
     * identifier never becomes a readable row. A 422 rather than a 404: the
     * caller is addressing a membership they may see, and what is wrong is a
     * value inside the body.
     *
     * @param  list<string>  $roleIds
     *
     * @throws ApiException
     */
    private function assertRolesAreAssignable(OrganisationMembership $membership, array $roleIds): void
    {
        if ($roleIds === []) {
            return;
        }

        $assignable = Role::query()->whereIn('id', $roleIds)->pluck('id')->map(strval(...))->all();
        $refused = array_values(array_diff($roleIds, $assignable));

        if ($refused !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Those roles are not available in this organisation.',
                [
                    'fields' => ['roles' => ['Those roles are not available in this organisation.']],
                    'refused_role_ids' => $refused,
                ],
            );
        }
    }

    /**
     * Refuse a replacement that takes the caller's own role-management
     * authority away.
     *
     * Only ever fires when the membership being edited is the caller's own —
     * removing somebody *else's* administrator role is permitted, and merely
     * counted through `remaining_role_administrators`. The line is at the
     * caller's own foot, because that is the one mistake nothing inside this
     * console can undo: the next request is refused by the same middleware that
     * would have let them fix it.
     *
     * @param  list<string>  $roleIds
     *
     * @throws ApiException
     */
    private function assertActorKeepsTheKeys(
        OrganisationMembership $membership,
        array $roleIds,
        ?string $actorMembershipId,
    ): void {
        if ($actorMembershipId === null || (string) $membership->getKey() !== $actorMembershipId) {
            return;
        }

        if (in_array('role.manage_organisation', $this->query->codesForRoleSet($roleIds), true)) {
            return;
        }

        throw new ApiException(
            ErrorCode::AccessSelfLockout,
            'This would remove your own ability to manage roles, and nobody can give it back to you from inside this console.',
            ['reason' => 'role_management_removed_from_own_membership'],
        );
    }

    /**
     * @throws ApiException
     */
    private function bumpMembership(OrganisationMembership $membership, int $expectedLockVersion): void
    {
        $affected = OrganisationMembership::query()
            ->whereKey($membership->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update(['lock_version' => $expectedLockVersion + 1, 'updated_at' => now()]);

        if ($affected === 0) {
            $current = OrganisationMembership::query()->whereKey($membership->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $membership->refresh();
    }
}
