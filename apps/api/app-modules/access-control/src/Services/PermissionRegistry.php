<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Services;

/**
 * The seeded foundation permission catalogue and platform template roles.
 * Kitchen and commercial permissions remain registry proposals until those
 * modules are implemented (plan §10).
 */
final class PermissionRegistry
{
    /**
     * Permission code format: domain.action_scope.
     */
    public const string CODE_FORMAT = '/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/';

    /**
     * The foundation permission set, keyed by code.
     *
     * @return array<string, array{domain: string, description: string}>
     */
    public static function foundationPermissions(): array
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
     * Platform template roles (organisation_id NULL, is_system true), keyed
     * by role code.
     *
     * @return array<string, array{name_en: string, name_ar: string, permissions: list<string>}>
     */
    public static function templateRoles(): array
    {
        $all = self::codes();

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
