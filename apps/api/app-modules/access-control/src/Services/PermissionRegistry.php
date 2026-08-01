<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Services;

/**
 * The seeded permission catalogue and platform template roles.
 *
 * The catalogue is split in two (master plan v2 §4.16). Organisation
 * permissions are the ones a tenant may hold: everything scoped to the current
 * organisation or to the caller's own records. Platform permissions are the
 * ones only a platform operator may hold — tenant lifecycle, cross-tenant
 * review, reference-data governance. Template roles for organisations are built
 * exclusively from the organisation set, so no organisation role, not even
 * `organisation_owner`, can ever acquire a platform code by inheriting "all
 * permissions". `PermissionRegistryTest` is the regression proof.
 *
 * Kitchen and commercial permissions remain registry proposals until those
 * modules are implemented (plan §10); each phase introduces only the codes its
 * own endpoints raise.
 */
final class PermissionRegistry
{
    /**
     * Permission code format: domain.action_scope.
     */
    public const string CODE_FORMAT = '/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/';

    /**
     * The registered permission set — organisation codes then platform codes,
     * keyed by code. This is what the seeder writes and what a Gate ability is
     * matched against.
     *
     * @return array<string, array{domain: string, description: string}>
     */
    public static function foundationPermissions(): array
    {
        return [...self::organisationPermissions(), ...self::platformPermissions()];
    }

    /**
     * Permissions an organisation may hold: organisation-scoped or own-scoped.
     * Organisation template roles are assembled from this set and nothing else.
     *
     * @return array<string, array{domain: string, description: string}>
     */
    public static function organisationPermissions(): array
    {
        return [
            'organisation.view_current' => ['domain' => 'organisation', 'description' => 'View the current organisation'],
            'organisation.update_current' => ['domain' => 'organisation', 'description' => 'Update the current organisation'],
            'branch.view_current' => ['domain' => 'branch', 'description' => 'View branches of the current organisation'],
            'branch.manage_current' => ['domain' => 'branch', 'description' => 'Create, update and close branches of the current organisation'],
            'membership.view_organisation' => ['domain' => 'membership', 'description' => 'View memberships of the organisation'],
            'membership.invite_organisation' => ['domain' => 'membership', 'description' => 'Invite users into the organisation'],
            'membership.update_organisation' => ['domain' => 'membership', 'description' => 'Update memberships of the organisation'],
            'membership.end_organisation' => ['domain' => 'membership', 'description' => 'End memberships of the organisation'],
            'role.view_organisation' => ['domain' => 'role', 'description' => 'View roles of the organisation'],
            'role.manage_organisation' => ['domain' => 'role', 'description' => 'Manage roles and role assignments of the organisation'],
            'user.manage_organisation' => ['domain' => 'user', 'description' => 'Manage user accounts within the organisation'],
            'session.revoke_own' => ['domain' => 'session', 'description' => 'Revoke own sessions'],
            'device.manage_own' => ['domain' => 'device', 'description' => 'Register and revoke own devices'],
            'profile.view_own' => ['domain' => 'profile', 'description' => 'View own profile'],
            'profile.update_own' => ['domain' => 'profile', 'description' => 'Update own profile'],
            'consent.view_own' => ['domain' => 'consent', 'description' => 'View own consent records'],
            'consent.manage_own' => ['domain' => 'consent', 'description' => 'Grant and withdraw own consents'],
            'entitlement.view_organisation' => ['domain' => 'entitlement', 'description' => 'View feature entitlements of the organisation'],
            'subscription.view_organisation' => ['domain' => 'subscription', 'description' => 'View subscriptions of the organisation'],
            'audit.view_organisation' => ['domain' => 'audit', 'description' => 'View the audit trail of the organisation'],
        ];
    }

    /**
     * Permissions only a platform operator may hold. Deliberately empty: the
     * foundation exposes no platform-operator surface, and every phase adds
     * only the codes its own endpoints raise. A code added here is unreachable
     * from any organisation template role by construction.
     *
     * @return array<string, array{domain: string, description: string}>
     */
    public static function platformPermissions(): array
    {
        return [];
    }

    /**
     * @return list<string>
     */
    public static function codes(): array
    {
        return array_keys(self::foundationPermissions());
    }

    /**
     * Whether a Gate ability string is a registered permission code (used to
     * route those abilities through the PermissionChecker).
     */
    public static function isPermissionCode(string $ability): bool
    {
        return array_key_exists($ability, self::foundationPermissions());
    }

    /**
     * Platform-defined template roles for organisations (organisation_id NULL,
     * is_system true), keyed by role code.
     *
     * Every role here is organisation-scoped and is therefore built from
     * `organisationPermissions()`, never from the full catalogue: the owner of
     * an organisation holds every permission an organisation has, which is not
     * the same thing as every permission that exists.
     *
     * @return array<string, array{name_en: string, name_ar: string, permissions: list<string>}>
     */
    public static function templateRoles(): array
    {
        $all = array_keys(self::organisationPermissions());

        $ownScope = [
            'session.revoke_own',
            'device.manage_own',
            'profile.view_own',
            'profile.update_own',
            'consent.view_own',
            'consent.manage_own',
        ];

        return [
            'organisation_owner' => [
                'name_en' => 'Organisation owner',
                'name_ar' => 'مالك المنشأة',
                'permissions' => $all,
            ],
            'organisation_admin' => [
                'name_en' => 'Organisation administrator',
                'name_ar' => 'مدير المنشأة',
                'permissions' => array_values(array_diff($all, ['role.manage_organisation'])),
            ],
            'branch_manager' => [
                'name_en' => 'Branch manager',
                'name_ar' => 'مدير الفرع',
                'permissions' => [
                    'branch.view_current',
                    'branch.manage_current',
                    'membership.view_organisation',
                ],
            ],
            'member' => [
                'name_en' => 'Member',
                'name_ar' => 'عضو',
                'permissions' => array_merge([
                    'organisation.view_current',
                ], $ownScope),
            ],
        ];
    }
}
