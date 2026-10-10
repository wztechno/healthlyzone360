<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Illuminate\Support\Facades\DB;

/**
 * Creating, re-granting and deleting a kitchen's own roles.
 *
 * Every write here is a change to what somebody may do, which is why three
 * things that would be optional elsewhere are not optional here: the grant set
 * is replaced rather than patched, the version is compared inside the same
 * statement that writes, and the permission cache is bumped explicitly rather
 * than left to the observer.
 *
 * ## The grant set is replaced, never merged
 *
 * `save()` takes the codes the role should end up with and reconciles —
 * inserting what is new, deleting what is gone. That is the same thing
 * `TemplateRoleSeeder` does to a template on every run, and for its reason: an
 * additive API cannot express "take this away", and a role editor whose whole
 * job is taking things away would need a second endpoint to do the half that
 * matters.
 *
 * ## Self-lockout, and why it is computed after rather than before
 *
 * The guard asks whether the *actor* would still hold `role.manage_organisation`
 * once this save landed — so it has to build the hypothetical grant set first
 * and ask the question of that, not of the request body. An administrator
 * removing that code from a role they hold is removing their own way back in,
 * and there is no undo: the next request is refused by the same middleware that
 * would have let them fix it.
 *
 * Deliberately **not** a check on whether anybody else is left. Removing the
 * last *other* administrator is permitted and merely counted, the shape PA1
 * settled on: a console that refused the thing the operator opened it to do is
 * a control that has made itself unusable. The line is drawn at the caller's
 * own foot.
 *
 * ## The cache bump is explicit
 *
 * `PermissionVersionObserver` watches `Role`, `RolePermission` and
 * `MembershipRole`, so in the ordinary case the bump is automatic. It is done
 * again by hand for the reason `KitchenOwners::revoke()` states about its own:
 * a bulk delete does not fire model events, and a grant removed by a bulk
 * statement would stay cached and valid for another five minutes — which on
 * this surface means a permission somebody believes they revoked still working.
 */
final readonly class RoleWriter
{
    public function __construct(
        private AccessAdministrationQuery $query,
        private GrantBoundary $boundary,
        private PermissionCache $cache,
    ) {}

    /**
     * Create a role belonging to this organisation.
     *
     * `is_system` is never settable. A tenant-created role is by definition not
     * platform-defined, and a request that could set the flag could create a
     * role it could then never edit.
     *
     * @param  array{code: string, name_en: string, name_ar: string, description_en: ?string, description_ar: ?string, permissions: list<string>}  $input
     * @param  list<string>  $actorCodes
     *
     * @throws ApiException
     */
    public function create(Organisation $organisation, array $input, User $actor, array $actorCodes): Role
    {
        $codes = $this->boundary->assertOrganisationScoped($input['permissions']);
        $this->boundary->assertMayGrant($codes, $actor, $actorCodes);

        $this->assertCodeIsFree($organisation, $input['code']);

        return DB::transaction(function () use ($organisation, $input, $actor, $codes): Role {
            $role = Role::query()->create([
                'organisation_id' => $organisation->getKey(),
                'code' => $input['code'],
                'name_en' => $input['name_en'],
                'name_ar' => $input['name_ar'],
                'description_en' => $input['description_en'],
                'description_ar' => $input['description_ar'],
                'is_system' => false,
                'created_by' => $actor->getKey(),
                'updated_by' => $actor->getKey(),
                'lock_version' => 0,
            ]);

            $this->reconcileGrants($role, $codes);
            $this->cache->bumpVersion((string) $organisation->getKey());

            return $role;
        });
    }

    /**
     * Rename a role and replace what it grants.
     *
     * `code` is deliberately absent from the writable set. It is what
     * `MembershipGranter::role()` matches an invitation on, so changing it would
     * silently redirect every outstanding invitation naming the old one — a
     * consequence nobody editing a permission list expects. Renaming is
     * `name_en`/`name_ar`, which is what a person means by it.
     *
     * @param  array{name_en: string, name_ar: string, description_en: ?string, description_ar: ?string, permissions: list<string>}  $input
     * @param  list<string>  $actorCodes
     *
     * @throws ApiException
     */
    public function update(
        Role $role,
        array $input,
        int $expectedLockVersion,
        User $actor,
        ?string $actorMembershipId,
        array $actorCodes,
    ): Role {
        $codes = $this->boundary->assertOrganisationScoped($input['permissions']);
        $this->boundary->assertMayGrant($codes, $actor, $actorCodes);

        $this->assertActorKeepsTheKeys($role, $codes, $actorMembershipId);

        return DB::transaction(function () use ($role, $input, $expectedLockVersion, $actor, $codes): Role {
            $this->compareAndSwap($role, [
                'name_en' => $input['name_en'],
                'name_ar' => $input['name_ar'],
                'description_en' => $input['description_en'],
                'description_ar' => $input['description_ar'],
                'updated_by' => $actor->getKey(),
            ], $expectedLockVersion);

            $this->reconcileGrants($role, $codes);
            $this->cache->bumpVersion((string) $role->organisation_id);

            return $role;
        });
    }

    /**
     * Delete a role nobody holds.
     *
     * Refused while any membership still points at it, and the refusal carries
     * the count rather than a bare conflict. `membership_roles` cascades on
     * delete, so the database would happily take this role away from six people
     * without saying so — which is precisely the silent revocation this whole
     * module exists to make impossible. Reassign first, then delete.
     *
     * Not a soft delete: there are none anywhere on this platform, and a role
     * that nobody holds and that grants nothing to anybody is a row with no
     * remaining meaning.
     *
     * @throws ApiException
     */
    public function delete(Role $role, int $expectedLockVersion): void
    {
        $holders = $this->query->holderCountFor((string) $role->getKey());

        if ($holders > 0) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This role is still assigned to people. Reassign them before deleting it.',
                [
                    'membership_count' => $holders,
                    'membership_ids' => array_slice($this->holderIds($role), 0, 20),
                ],
            );
        }

        DB::transaction(function () use ($role, $expectedLockVersion): void {
            // The version is compared by a conditional delete for the same
            // reason an update compares it: somebody may have granted this role
            // to a new starter between the list being read and Delete being
            // pressed, and a delete that ignored the version would take it back
            // off them without a word.
            $affected = Role::query()
                ->whereKey($role->getKey())
                ->where('lock_version', $expectedLockVersion)
                ->delete();

            if ($affected === 0) {
                $current = Role::query()->whereKey($role->getKey())->value('lock_version');

                throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
            }

            $this->cache->bumpVersion((string) $role->organisation_id);
        });
    }

    /**
     * Insert what is new, remove what is gone, touch nothing that stayed.
     *
     * Reconciling rather than deleting-and-reinserting keeps `created_at` on a
     * grant that was never withdrawn, which is what makes "when did this role
     * gain the ability to cancel orders" answerable from the row.
     *
     * @param  list<string>  $codes
     */
    private function reconcileGrants(Role $role, array $codes): void
    {
        $permissionIds = Permission::query()->whereIn('code', $codes)->pluck('id', 'code')->all();

        $existing = RolePermission::withoutTenancy()
            ->where('role_id', $role->getKey())
            ->pluck('permission_id')
            ->all();

        $wanted = array_values($permissionIds);

        foreach (array_diff($wanted, $existing) as $permissionId) {
            RolePermission::withoutTenancy()->create([
                'role_id' => $role->getKey(),
                'permission_id' => $permissionId,
                'organisation_id' => $role->organisation_id,
            ]);
        }

        $stale = array_diff($existing, $wanted);

        if ($stale !== []) {
            RolePermission::withoutTenancy()
                ->where('role_id', $role->getKey())
                ->whereIn('permission_id', $stale)
                ->delete();
        }
    }

    /**
     * Refuse a save that would take the caller's own role-management authority
     * away.
     *
     * The hypothesis is built the way `PermissionChecker` will read it: the
     * actor's other roles, unchanged, plus this role with its proposed grants.
     * An actor with no membership in context cannot lock themselves out of
     * anything, so there is nothing to refuse.
     *
     * @param  list<string>  $codes
     *
     * @throws ApiException
     */
    private function assertActorKeepsTheKeys(Role $role, array $codes, ?string $actorMembershipId): void
    {
        if ($actorMembershipId === null) {
            return;
        }

        $assignments = $this->query->assignmentsFor($actorMembershipId);
        $heldRoleIds = array_column($assignments, 'role_id');

        if (! in_array((string) $role->getKey(), $heldRoleIds, true)) {
            return;
        }

        if (in_array('role.manage_organisation', $codes, true)) {
            return;
        }

        $others = array_values(array_diff($heldRoleIds, [(string) $role->getKey()]));

        if (in_array('role.manage_organisation', $this->query->codesForRoleSet($others), true)) {
            return;
        }

        throw new ApiException(
            ErrorCode::AccessSelfLockout,
            'This would remove your own ability to manage roles, and nobody can give it back to you from inside this console.',
            ['reason' => 'role_management_removed_from_own_role', 'role_id' => (string) $role->getKey()],
        );
    }

    /**
     * @throws ApiException
     */
    private function assertCodeIsFree(Organisation $organisation, string $code): void
    {
        $taken = Role::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->where('code', $code)
            ->exists();

        if ($taken) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This organisation already has a role with that code.',
                ['fields' => ['code' => ['This organisation already has a role with that code.']]],
            );
        }
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws ApiException
     */
    private function compareAndSwap(Role $role, array $changes, int $expectedLockVersion): void
    {
        $affected = Role::query()
            ->whereKey($role->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = Role::query()->whereKey($role->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $role->refresh();
    }

    /** @return list<string> */
    private function holderIds(Role $role): array
    {
        /** @var list<string> */
        return MembershipRole::withoutTenancy()
            ->where('role_id', $role->getKey())
            ->pluck('membership_id')
            ->all();
    }
}
