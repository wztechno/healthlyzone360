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

            // Phase K1.1 — the kitchen catalogue. Only the codes this slice's
            // endpoints raise; recipes, plans, prices and delivery zones
            // arrive with the slices that serve them.
            'catalogue.view_organisation' => ['domain' => 'catalogue', 'description' => 'View the ingredient catalogue of the organisation'],
            'catalogue.manage_organisation' => ['domain' => 'catalogue', 'description' => 'Create and update ingredients, categories, aliases and allergen mappings of the organisation'],

            // Phase K1.2 — recipes and their versions. Publication is a third
            // code, not a corner of `manage`: publishing freezes an allergen
            // label that reaches a diner and withdraws whatever was live
            // before, which is a different kind of authority from editing a
            // draft. A chef writes the formulation; deciding it is what the
            // kitchen sells is a separate decision, and the permission
            // registry is where that separation has to be real.
            //
            'recipe.view_organisation' => ['domain' => 'recipe', 'description' => 'View recipes and their versions, lines, outputs, steps and allergen labels'],
            'recipe.manage_organisation' => ['domain' => 'recipe', 'description' => 'Create and edit recipes and draft versions of the organisation'],
            'recipe.publish_organisation' => ['domain' => 'recipe', 'description' => 'Publish and retire recipe versions of the organisation'],

            // Phase K1.3 — a fourth code, and the split that motivates it is
            // the whole reason costs are a separate slice. Reading a
            // formulation and reading its margin are different needs:
            // `recipe.view_organisation` lets a line cook read the method to
            // make the dish, and this code is what it takes to see what the
            // dish costs. Splitting them is the only way that separation is
            // real rather than a convention nobody enforces (appendix C).
            //
            // It gates the read *and* the write: writing a unit cost blind is
            // how a decimal point moves three places, and erasing one blind is
            // worse, because positional line identity means it cannot be put
            // back.
            'recipe.view_costs_organisation' => ['domain' => 'recipe', 'description' => 'View and write recipe costs: technical sheets, cost snapshots and line unit costs'],

            // Phase K1.4 — the sellable catalogue. Reads and edits reuse
            // `catalogue.view_organisation` / `catalogue.manage_organisation`:
            // ingredients, categories and items are one catalogue, and a
            // fifth pair of codes over the same screens would be bookkeeping
            // rather than authority.
            //
            // Publication is not. `catalogue.publish_organisation` is the
            // authority to decide what a customer can buy — it makes a listing
            // visible, freezes what its allergen label will say, and withdraws
            // whatever was live before. That is the same separation
            // `recipe.publish_organisation` draws one level down, and it stays
            // separate here for the same reason: a chef writes the
            // formulation, a merchandiser writes the listing, and neither of
            // them decides the range.
            'catalogue.publish_organisation' => ['domain' => 'catalogue', 'description' => 'Publish and retire catalogue items of the organisation'],
        ];
    }

    /**
     * Permissions only a platform operator may hold. Every phase adds only the
     * codes its own endpoints raise, and a code added here is unreachable from
     * any organisation template role by construction — `templateRoles()` is
     * built from `organisationPermissions()` alone.
     *
     * K1.1 introduces the first two: the regulatory allergen vocabulary is
     * shared by every tenant, so nobody inside a tenant may edit it. Granting
     * these is a deliberate act on a bespoke organisation role inside the
     * platform-operator organisation, never an inheritance.
     *
     * @return array<string, array{domain: string, description: string}>
     */
    public static function platformPermissions(): array
    {
        return [
            'reference.view_platform' => ['domain' => 'reference', 'description' => 'View platform reference vocabularies, including inactive entries'],
            'reference.manage_platform' => ['domain' => 'reference', 'description' => 'Create, update and deactivate platform reference vocabularies'],
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

            // ── Kitchen roles (phase K1) ─────────────────────────────────
            //
            // Introduced with K1.1 holding only the codes that exist today.
            // Later K1 slices widen them as they introduce recipe, plan,
            // price and delivery permissions; TemplateRoleSeeder reconciles
            // grants on every run, so widening a role here is enough and a
            // code removed from a role is removed from the database too.
            //
            // No platform template role exists, and none ever will: an
            // organisation template must never carry a platform code, so the
            // platform-operator organisation grants `reference.*_platform`
            // through a bespoke organisation-scoped role instead
            // (DemoTenantSeeder demonstrates the path).
            'kitchen_manager' => [
                'name_en' => 'Kitchen manager',
                'name_ar' => 'مدير المطبخ',
                'permissions' => [
                    'catalogue.view_organisation',
                    'catalogue.manage_organisation',
                    'catalogue.publish_organisation',
                    'recipe.view_organisation',
                    'recipe.manage_organisation',
                    'recipe.publish_organisation',
                    'recipe.view_costs_organisation',
                    'organisation.view_current',
                    'branch.view_current',
                    'membership.view_organisation',
                ],
            ],

            // A chef writes formulations and does not decide what the kitchen
            // sells: `recipe.publish_organisation` stops here deliberately.
            // Costs do not: a chef who cannot see what a substitution does to
            // the cost of a dish is a chef who cannot cost a dish, and the
            // lines endpoint is where unit costs are keyed in.
            'kitchen_chef' => [
                'name_en' => 'Chef',
                'name_ar' => 'رئيس الطهاة',
                'permissions' => [
                    'catalogue.view_organisation',
                    'catalogue.manage_organisation',
                    'recipe.view_organisation',
                    'recipe.manage_organisation',
                    'recipe.view_costs_organisation',
                ],
            ],

            // The role the cost split exists for. Kitchen staff read the
            // method and the allergen label — everything needed to make the
            // dish — and no money at all.
            'kitchen_staff' => [
                'name_en' => 'Kitchen staff',
                'name_ar' => 'طاقم المطبخ',
                'permissions' => [
                    'catalogue.view_organisation',
                    'recipe.view_organisation',
                ],
            ],

            // The mirror image: margins are this role's whole job, and
            // `recipe.manage_organisation` is deliberately absent so that
            // reading a cost never comes with the ability to change the
            // formulation behind it.
            //
            // It *does* hold `catalogue.publish_organisation` (K1.4). Deciding
            // what the kitchen sells and at what price is exactly this role's
            // authority, and it is the one place where the commercial side
            // outranks the kitchen: a commercial manager may put a dish on
            // sale without being able to change a single line of how it is
            // made. `catalogue.manage_organisation` stays absent for the same
            // reason `recipe.manage_organisation` does.
            'commercial_manager' => [
                'name_en' => 'Commercial manager',
                'name_ar' => 'المدير التجاري',
                'permissions' => [
                    'catalogue.view_organisation',
                    'catalogue.publish_organisation',
                    'recipe.view_organisation',
                    'recipe.view_costs_organisation',
                ],
            ],
        ];
    }
}
