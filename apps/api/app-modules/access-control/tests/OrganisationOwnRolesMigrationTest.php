<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Giving every organisation its own roles, without changing anybody's access
|--------------------------------------------------------------------------
|
| The data migration that retired the shared template rows. What it must never
| do is change what a person can reach: everybody holding a template moves onto
| a copy with exactly the template's grants, and a kitchen that already defined
| its own role with a template's code keeps that role untouched — its template
| holders get a `<code>_standard` copy instead of being folded onto it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

function migrationKitchen(): Organisation
{
    return Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);
}

function migrationMember(Organisation $organisation): OrganisationMembership
{
    return OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => User::factory()->create()->getKey(),
    ]);
}

function holdRole(OrganisationMembership $membership, Role $role, array $attributes = []): MembershipRole
{
    return MembershipRole::factory()->create([
        'organisation_id' => $membership->organisation_id,
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
        ...$attributes,
    ]);
}

function templateRole(string $code): Role
{
    return Role::withoutTenancy()->whereNull('organisation_id')->where('code', $code)->sole();
}

/** @return list<string> */
function grantedCodes(Role $role): array
{
    return RolePermission::withoutTenancy()
        ->where('role_id', $role->getKey())
        ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
        ->orderBy('permissions.code')
        ->pluck('permissions.code')
        ->all();
}

function runOwnRolesMigration(): void
{
    $migration = require dirname(__DIR__).'/database/migrations/2026_10_26_000001_give_every_organisation_its_own_roles.php';
    $migration->up();
}

it('copies every template into the organisation and moves its holders, bounds and all', function (): void {
    $kitchen = migrationKitchen();
    $chef = migrationMember($kitchen);
    $assignment = holdRole($chef, templateRole('kitchen_chef'), [
        'starts_at' => now()->subDay(),
        'expires_at' => now()->addMonth(),
    ]);

    runOwnRolesMigration();

    $codes = Role::withoutTenancy()->where('organisation_id', $kitchen->getKey())->pluck('code')->sort()->values()->all();
    expect($codes)->toBe(collect(array_keys(PermissionRegistry::templateRoles()))->sort()->values()->all());

    $copy = Role::withoutTenancy()->where('organisation_id', $kitchen->getKey())->where('code', 'kitchen_chef')->sole();
    $moved = MembershipRole::withoutTenancy()->whereKey($assignment->getKey())->sole();

    expect($copy->is_system)->toBeFalse()
        ->and(grantedCodes($copy))->toBe(grantedCodes(templateRole('kitchen_chef')))
        ->and((string) $moved->role_id)->toBe((string) $copy->getKey())
        ->and($moved->starts_at?->toDateString())->toBe($assignment->starts_at?->toDateString())
        ->and($moved->expires_at?->toDateString())->toBe($assignment->expires_at?->toDateString());
});

it('keeps a kitchen’s own role of a template’s code, and gives the template’s holders a standard copy', function (): void {
    $kitchen = migrationKitchen();
    $custom = Role::factory()->create([
        'organisation_id' => $kitchen->getKey(),
        'code' => 'kitchen_chef',
        'name_en' => 'Our chef',
        'is_system' => false,
    ]);

    $both = migrationMember($kitchen);
    holdRole($both, templateRole('kitchen_chef'));
    holdRole($both, $custom);

    runOwnRolesMigration();

    $standard = Role::withoutTenancy()->where('organisation_id', $kitchen->getKey())->where('code', 'kitchen_chef_standard')->sole();
    $held = MembershipRole::withoutTenancy()->where('membership_id', $both->getKey())->pluck('role_id')->map(strval(...))->sort()->values()->all();

    expect($custom->fresh()?->name_en)->toBe('Our chef')
        ->and($standard->name_en)->toBe(templateRole('kitchen_chef')->name_en.' (standard)')
        ->and(grantedCodes($standard))->toBe(grantedCodes(templateRole('kitchen_chef')))
        ->and($held)->toBe(collect([(string) $custom->getKey(), (string) $standard->getKey()])->sort()->values()->all());
});

it('leaves no assignment pointing at a platform template, and is safe to run twice', function (): void {
    $kitchen = migrationKitchen();
    holdRole(migrationMember($kitchen), templateRole('organisation_owner'));

    runOwnRolesMigration();
    $roles = Role::withoutTenancy()->where('organisation_id', $kitchen->getKey())->count();
    runOwnRolesMigration();

    $stranded = MembershipRole::withoutTenancy()
        ->join('roles', 'roles.id', '=', 'membership_roles.role_id')
        ->whereNull('roles.organisation_id')
        ->count();

    expect($stranded)->toBe(0)
        ->and(Role::withoutTenancy()->where('organisation_id', $kitchen->getKey())->count())->toBe($roles);
});
