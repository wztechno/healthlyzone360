<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;

/**
 * The world the access-administration suites are set in: a kitchen, the people
 * in it, and the roles they hold.
 *
 * A fixture class rather than Pest helper functions, for the reason
 * `CatalogueWorld` and `PricingWorld` both give: Pest loads every file in the
 * suite into one process, so several files declaring `accessTenant()` would be
 * a fatal redeclaration rather than a test failure.
 *
 * It deliberately does **not** build on `CatalogueWorld`. That fixture creates a
 * catalogue, ingredients, allergens and measurement units, none of which any
 * test here reads — and the module registry has no `AccessAdministration →
 * Catalogues` edge, so borrowing it would open one for convenience. This
 * module's subject is memberships and roles, which is exactly what this
 * fixture makes and nothing else.
 */
final class AccessWorld
{
    /**
     * What an administrator holds: enough to read and write everything on this
     * surface, and nothing from any other domain.
     *
     * Named as a constant so a test wanting a caller *without* one of them can
     * subtract rather than re-list — the idiom `CatalogueWorld::FULL_PERMISSIONS`
     * establishes, and the one that keeps a negative test honest.
     *
     * @var list<string>
     */
    public const array ADMINISTRATOR_PERMISSIONS = [
        'organisation.view_current',
        'membership.view_organisation',
        'membership.invite_organisation',
        'membership.update_organisation',
        'membership.end_organisation',
        'role.view_organisation',
        'role.manage_organisation',
        'user.manage_organisation',
    ];

    /** A caller who may read the console and change nothing in it. */
    public const array VIEWER_PERMISSIONS = [
        'organisation.view_current',
        'membership.view_organisation',
        'role.view_organisation',
    ];

    public static function organisation(): Organisation
    {
        return Organisation::factory()->create([
            'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
            'country_code' => 'LB',
            'default_currency_code' => 'USD',
            'default_language_code' => 'en',
        ]);
    }

    /**
     * A kitchen whose caller holds exactly `$permissions`, through one bespoke
     * role of its own.
     *
     * The role is bespoke rather than a seeded template on purpose: a test that
     * assigned `organisation_owner` would be testing the seeder's opinion about
     * that role as much as the endpoint, and would change meaning the next time
     * somebody edited `PermissionRegistry`.
     *
     * @param  list<string>  $permissions
     */
    public static function kitchen(string $email, array $permissions = self::ADMINISTRATOR_PERMISSIONS): object
    {
        $organisation = self::organisation();
        $user = User::factory()->create(['email' => $email]);

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'user_id' => $user->getKey(),
        ]);

        $role = self::role($organisation, 'administrator', $permissions);

        MembershipRole::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'membership_id' => $membership->getKey(),
            'role_id' => $role->getKey(),
        ]);

        return (object) compact('organisation', 'user', 'membership', 'role');
    }

    /**
     * A second person in an existing kitchen, holding `$permissions` through a
     * role of their own.
     *
     * Their own role rather than a share of the caller's: every lock-out test
     * turns on whether a change touches the *actor's* authority or somebody
     * else's, and two people on one role would make that distinction
     * unexpressible.
     *
     * @param  list<string>  $permissions
     */
    public static function colleague(
        object $tenant,
        string $email,
        array $permissions = [],
        string $roleCode = 'colleague',
    ): object {
        $user = User::factory()->create(['email' => $email]);

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'user_id' => $user->getKey(),
        ]);

        $role = self::role($tenant->organisation, $roleCode, $permissions);

        MembershipRole::factory()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'membership_id' => $membership->getKey(),
            'role_id' => $role->getKey(),
        ]);

        return (object) compact('user', 'membership', 'role');
    }

    /**
     * A role belonging to an organisation, granting exactly `$codes`.
     *
     * @param  list<string>  $codes
     */
    public static function role(Organisation $organisation, string $code, array $codes): Role
    {
        $role = Role::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => $code,
            'is_system' => false,
        ]);

        foreach ($codes as $permissionCode) {
            RolePermission::factory()->create([
                'organisation_id' => $organisation->getKey(),
                'role_id' => $role->getKey(),
                'permission_id' => Permission::query()->where('code', $permissionCode)->sole()->getKey(),
            ]);
        }

        return $role;
    }

    /**
     * Give an existing membership another role, template or bespoke.
     *
     * `kitchen()` and `colleague()` each build a membership with exactly one
     * role; this is for the case where what is under test is somebody holding
     * two at once — the two sides of the `roles` SELECT predicate, say.
     */
    public static function assign(object $tenant, Role $role): MembershipRole
    {
        return MembershipRole::factory()->create([
            'organisation_id' => $tenant->organisation->getKey(),
            'membership_id' => $tenant->membership->getKey(),
            'role_id' => $role->getKey(),
        ]);
    }

    /** The platform template of a given code — seeded, `is_system`, never editable. */
    public static function template(string $code): Role
    {
        return Role::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', $code)
            ->sole();
    }

    /**
     * @return array<string, string>
     */
    public static function headers(object $tenant): array
    {
        return firstPartyHeaders() + ['X-Organisation-Id' => (string) $tenant->organisation->getKey()];
    }

    /** The `If-Match` a lock-versioned write requires. */
    public static function ifMatch(int $lockVersion): array
    {
        return ['If-Match' => '"'.$lockVersion.'"'];
    }
}
