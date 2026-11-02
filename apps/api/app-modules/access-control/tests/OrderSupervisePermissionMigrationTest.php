<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\OrganisationRoles;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| order.supervise_organisation reaches a database a deploy never re-seeds
|--------------------------------------------------------------------------
|
| A deployed database has the code in neither `permissions` nor any role. Here
| the seeded world stands in for that one: the permission row is deleted, which
| cascades its grants away, and the migration has to put everything back.
|
*/

function runSuperviseMigration(): void
{
    $migration = require dirname(__DIR__).'/database/migrations/2026_11_02_000103_grant_order_supervise_organisation_permission.php';
    $migration->up();
}

function holdsSupervise(Role $role): bool
{
    return RolePermission::withoutTenancy()
        ->where('role_id', $role->getKey())
        ->whereIn('permission_id', Permission::query()->where('code', 'order.supervise_organisation')->select('id'))
        ->exists();
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->kitchen = Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);

    app(OrganisationRoles::class)->provision((string) $this->kitchen->getKey());

    $this->copy = fn (string $code): Role => Role::withoutTenancy()
        ->where('organisation_id', $this->kitchen->getKey())
        ->where('code', $code)
        ->sole();

    $this->template = fn (string $code): Role => Role::withoutTenancy()
        ->whereNull('organisation_id')
        ->where('code', $code)
        ->sole();
});

it('writes the permission and grants it on the templates and on an organisation’s copies', function (string $code): void {
    DB::table('permissions')->where('code', 'order.supervise_organisation')->delete();

    runSuperviseMigration();

    $permission = Permission::query()->where('code', 'order.supervise_organisation')->sole();
    $copy = ($this->copy)($code);

    $grant = RolePermission::withoutTenancy()
        ->where('role_id', $copy->getKey())
        ->where('permission_id', $permission->getKey())
        ->sole();

    expect($permission->domain)->toBe('order')
        ->and($permission->is_assignable)->toBeTrue()
        ->and(holdsSupervise(($this->template)($code)))->toBeTrue()
        ->and((string) $grant->organisation_id)->toBe((string) $this->kitchen->getKey());
})->with(['organisation_owner', 'organisation_admin', 'kitchen_manager']);

it('reaches every copy the role split made for a kitchen that shadowed a template', function (string $code): void {
    $standard = Role::factory()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'code' => $code,
        'is_system' => false,
    ]);

    runSuperviseMigration();

    expect(holdsSupervise($standard))->toBeTrue();
})->with(['kitchen_manager_standard', 'organisation_owner_standard_2', 'organisation_admin_standard_13']);

it('leaves a kitchen’s own role alone, whatever it is called', function (string $code): void {
    Role::withoutTenancy()->where('organisation_id', $this->kitchen->getKey())->where('code', $code)->delete();

    $own = Role::factory()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'code' => $code,
        'is_system' => false,
        'created_by' => User::factory()->create()->getKey(),
    ]);

    runSuperviseMigration();

    expect(holdsSupervise($own))->toBeFalse();
})->with(['kitchen_manager', 'kitchen_manager_standard', 'organisation_owner_standard_2']);

it('does not take a lookalike code for a copy', function (string $code): void {
    $lookalike = Role::factory()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'code' => $code,
        'is_system' => false,
    ]);

    runSuperviseMigration();

    expect(holdsSupervise($lookalike))->toBeFalse();
})->with(['kitchen_manager_assistant', 'kitchen_manager_standard_x', 'head_kitchen_manager']);

it('leaves every other role alone', function (string $code): void {
    DB::table('permissions')->where('code', 'order.supervise_organisation')->delete();

    runSuperviseMigration();

    expect(holdsSupervise(($this->template)($code)))->toBeFalse()
        ->and(holdsSupervise(($this->copy)($code)))->toBeFalse();
})->with(['branch_manager', 'order_desk_agent', 'kitchen_chef']);

it('changes nothing on a database that already has it, and bumps nothing', function (): void {
    $cache = app(PermissionCache::class);

    runSuperviseMigration();

    $version = $cache->platformVersion();
    $grants = RolePermission::withoutTenancy()->count();

    runSuperviseMigration();

    expect(RolePermission::withoutTenancy()->count())->toBe($grants)
        ->and(Permission::query()->where('code', 'order.supervise_organisation')->count())->toBe(1)
        ->and($cache->platformVersion())->toBe($version);
});

it('drops every signed-in person’s cached permissions when it grants', function (): void {
    DB::table('permissions')->where('code', 'order.supervise_organisation')->delete();

    $cache = app(PermissionCache::class);
    $version = $cache->platformVersion();

    runSuperviseMigration();

    expect($cache->platformVersion())->toBeGreaterThan($version);
});
