<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Tests\Fixtures;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;

/**
 * The world the kitchens suite is set in: an organisation with two branches,
 * because every rule in this module is about which branch is in context.
 *
 * A fixture class rather than Pest helper functions, for the reason the other
 * module worlds give: Pest loads every test file in the suite into one
 * process, and two files declaring `kitchenTenant()` would be a fatal
 * redeclaration rather than a test failure.
 *
 * `branchScoped()` is the interesting builder — a membership pinned to one
 * branch is what makes cross-branch isolation testable, because that member
 * may not select the other branch at all.
 */
final class KitchenWorld
{
    /**
     * What it takes to read and write a branch's operating week. The
     * foundation `branch.*` pair, not a new code: when a branch is open is a
     * fact about the branch (K1.7).
     *
     * @var list<string>
     */
    public const array FULL_PERMISSIONS = [
        'branch.view_current',
        'branch.manage_current',
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
     * @param  list<string>  $permissions
     */
    public static function kitchen(string $email, array $permissions = self::FULL_PERMISSIONS, bool $branchScoped = false): object
    {
        $organisation = self::organisation();
        $user = User::factory()->create(['email' => $email]);

        $branch = self::branch($organisation, 'Main kitchen');
        $secondBranch = self::branch($organisation, 'Second kitchen');

        $membership = OrganisationMembership::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'user_id' => $user->getKey(),
            'branch_id' => $branchScoped ? $branch->getKey() : null,
        ]);

        $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

        foreach ($permissions as $code) {
            RolePermission::factory()->create([
                'organisation_id' => $organisation->getKey(),
                'role_id' => $role->getKey(),
                'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
            ]);
        }

        MembershipRole::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'membership_id' => $membership->getKey(),
            'role_id' => $role->getKey(),
        ]);

        return (object) compact('organisation', 'user', 'membership', 'role', 'branch', 'secondBranch');
    }

    public static function branch(Organisation $organisation, string $name): OrganisationBranch
    {
        return OrganisationBranch::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'name' => $name,
            'country_code' => $organisation->country_code,
            'city' => 'Beirut',
            'timezone' => 'Asia/Beirut',
            'status' => 'active',
            'lock_version' => 0,
        ]);
    }

    /**
     * Organisation context only — the state this module's endpoints refuse,
     * because a week belongs to one place.
     *
     * @return array<string, string>
     */
    public static function headers(object $tenant): array
    {
        return firstPartyHeaders() + ['X-Organisation-Id' => (string) $tenant->organisation->getKey()];
    }

    /**
     * @return array<string, string>
     */
    public static function branchHeaders(object $tenant, ?OrganisationBranch $branch = null): array
    {
        return self::headers($tenant) + ['X-Branch-Id' => (string) ($branch ?? $tenant->branch)->getKey()];
    }

    /**
     * A complete trading week: open every day, one cut-off, no closures. The
     * baseline a test asserting a *difference* starts from.
     *
     * @return list<array{weekday: int, opens_at: string, closes_at: string, order_cut_off_at: string}>
     */
    public static function openWeek(): array
    {
        return array_map(static fn (int $weekday): array => [
            'weekday' => $weekday,
            'opens_at' => '08:00',
            'closes_at' => '20:00',
            'order_cut_off_at' => '18:00',
        ], [1, 2, 3, 4, 5, 6, 7]);
    }
}
