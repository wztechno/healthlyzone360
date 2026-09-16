<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;

/**
 * The read projections the console renders, and — more importantly — the
 * arithmetic the lock-out guards depend on.
 *
 * ## Why this duplicates `PermissionChecker::calculatedPermissions()`
 *
 * It does not, quite, and the difference is the whole reason it exists. That
 * method answers "what may this person do **now**", reads through
 * `PermissionCache`, and is the hot path on every guarded request. Every guard
 * in this module has to answer a different question: "what would this person
 * be able to do **if I saved this**" — against a role set that is still in a
 * request body, or a grant list that has not been written. A cached answer
 * about the present is precisely the wrong answer to that.
 *
 * So the shape is deliberately the same as the checker's — the time-bounded
 * role set, the `role_permissions` join, the `is_assignable` filter — because
 * a guard that computed the hypothetical differently from how the checker will
 * compute the actual would refuse the wrong saves and permit the wrong ones.
 * If the checker's rule ever changes, this must change with it; that coupling
 * is real and is better stated than hidden.
 *
 * ## `withoutTenancy()` on the join tables, for the checker's reason
 *
 * `membership_roles` and `role_permissions` carry no PostgreSQL policy and are
 * read through the escape hatch by the checker itself. Reading them any other
 * way here would give two different answers to one question. Isolation is the
 * `membership_id` and `role_id` predicates, both of which came from rows the
 * tenant scope already admitted.
 */
final readonly class AccessAdministrationQuery
{
    /**
     * The permission codes a role grants, in catalogue order.
     *
     * @return list<string>
     */
    public function codesForRole(string $roleId): array
    {
        /** @var list<string> */
        return Permission::query()
            ->whereIn('id', RolePermission::withoutTenancy()->where('role_id', $roleId)->select('permission_id'))
            ->orderBy('code')
            ->pluck('code')
            ->all();
    }

    /**
     * The same, for several roles at once, keyed by role id.
     *
     * One query rather than one per role: the roles list renders a permission
     * count for every row, and a console that issues eleven queries to draw
     * eleven rows is a console that gets slower as a kitchen defines more roles.
     *
     * @param  list<string>  $roleIds
     * @return array<string, list<string>>
     */
    public function codesForRoles(array $roleIds): array
    {
        if ($roleIds === []) {
            return [];
        }

        $grants = RolePermission::withoutTenancy()
            ->whereIn('role_id', $roleIds)
            ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
            ->orderBy('permissions.code')
            ->get(['role_permissions.role_id', 'permissions.code']);

        $byRole = array_fill_keys($roleIds, []);

        foreach ($grants as $grant) {
            $byRole[(string) $grant->getAttribute('role_id')][] = (string) $grant->getAttribute('code');
        }

        return $byRole;
    }

    /**
     * The role rows assigned to a membership, time bounds included.
     *
     * Every assignment, not only the currently effective ones. A console that
     * hid an assignment because it starts on Monday would be a console that
     * cannot show you what you scheduled — and the editor would silently drop
     * it on the next save, because a PUT replaces what it was shown.
     *
     * @return list<array{role_id: string, starts_at: ?string, expires_at: ?string}>
     */
    public function assignmentsFor(string $membershipId): array
    {
        return MembershipRole::withoutTenancy()
            ->where('membership_id', $membershipId)
            ->orderBy('created_at')
            ->get()
            ->map(static fn (MembershipRole $assignment): array => [
                'role_id' => (string) $assignment->getAttribute('role_id'),
                'starts_at' => $assignment->starts_at?->toIso8601String(),
                'expires_at' => $assignment->expires_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * The permission codes a membership would hold if it were assigned exactly
     * `$roleIds` — the hypothesis every lock-out guard is built on.
     *
     * Time bounds are deliberately **ignored**. A role that starts next Monday
     * still counts here, because the question a guard asks is "will this person
     * be able to get back in", and an authority that arrives on Monday is one
     * they have. The mirror case is what makes it matter: a guard that counted
     * only currently-effective roles would happily let somebody schedule their
     * own administrator role to expire tonight, which is the lock-out it exists
     * to prevent, arriving on a timer.
     *
     * @param  list<string>  $roleIds
     * @return list<string>
     */
    public function codesForRoleSet(array $roleIds): array
    {
        if ($roleIds === []) {
            return [];
        }

        /** @var list<string> */
        return Permission::query()
            ->whereIn('id', RolePermission::withoutTenancy()->whereIn('role_id', $roleIds)->select('permission_id'))
            // The checker's own filter. A code that is not assignable grants
            // nothing at request time, so counting it here would let somebody
            // keep an authority they do not actually have.
            ->where('is_assignable', true)
            ->orderBy('code')
            ->pluck('code')
            ->all();
    }

    /** The codes a membership holds as things stand. */
    public function codesForMembership(string $membershipId): array
    {
        return $this->codesForRoleSet(
            array_column($this->assignmentsFor($membershipId), 'role_id'),
        );
    }

    /**
     * Every *active* membership of this organisation that can still administer
     * access, excluding one.
     *
     * Shaped after `KitchenOverviewQuery::ownersOf()` and serving the same
     * purpose: the console warns, the API does not refuse. The exclusion is how
     * a caller asks "who would be left if I did this" without having to do it
     * first.
     *
     * Only active memberships count. A suspended administrator cannot sign in,
     * so counting them would report an administrator the organisation does not
     * currently have — which is the one answer this number must never give.
     *
     * @return list<string> membership ids
     */
    public function roleAdministratorsOf(string $organisationId, ?string $excludingMembershipId = null): array
    {
        $administratorRoleIds = RolePermission::withoutTenancy()
            ->whereIn('permission_id', Permission::query()
                ->where('code', 'role.manage_organisation')
                ->where('is_assignable', true)
                ->select('id'))
            ->pluck('role_id')
            ->all();

        if ($administratorRoleIds === []) {
            return [];
        }

        $membershipIds = MembershipRole::withoutTenancy()
            ->whereIn('role_id', $administratorRoleIds)
            ->where('organisation_id', $organisationId)
            ->pluck('membership_id')
            ->unique()
            ->all();

        /** @var list<string> */
        return OrganisationMembership::query()
            ->whereIn('id', $membershipIds)
            ->where('status', MembershipStatus::Active)
            ->when(
                $excludingMembershipId !== null,
                static fn ($query) => $query->whereKeyNot($excludingMembershipId),
            )
            ->pluck('id')
            ->all();
    }

    /**
     * How many memberships hold a role — the number that decides whether it may
     * be deleted, and the number the roles list shows in its "held by" column.
     */
    public function holderCountFor(string $roleId): int
    {
        return MembershipRole::withoutTenancy()->where('role_id', $roleId)->count();
    }

    /**
     * The same for a page of roles, keyed by role id.
     *
     * @param  list<string>  $roleIds
     * @return array<string, int>
     */
    public function holderCountsFor(array $roleIds): array
    {
        if ($roleIds === []) {
            return [];
        }

        $counts = MembershipRole::withoutTenancy()
            ->whereIn('role_id', $roleIds)
            ->selectRaw('role_id, count(*) as holders')
            ->groupBy('role_id')
            ->pluck('holders', 'role_id')
            ->all();

        $filled = array_fill_keys($roleIds, 0);

        foreach ($counts as $roleId => $holders) {
            $filled[(string) $roleId] = (int) $holders;
        }

        return $filled;
    }

    /**
     * Whether this organisation has defined a role of its own carrying `$code`,
     * shadowing the platform template of the same name.
     *
     * Permitted, and reported rather than refused: `MembershipGranter::role()`
     * documents preferring a tenant's own role over the template, so a fork
     * that keeps the code is a supported way to change what a template means
     * inside one kitchen. The console says so on the create form, because a
     * kitchen that did it by accident and a kitchen that did it on purpose type
     * exactly the same thing.
     */
    public function shadowsTemplate(string $organisationId, string $code): bool
    {
        return Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', $code)
            ->exists()
            && Role::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('code', $code)
                ->exists();
    }
}
