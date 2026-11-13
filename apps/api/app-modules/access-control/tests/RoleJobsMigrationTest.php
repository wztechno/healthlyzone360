<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\OrganisationRoles;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Roles for real jobs reach a database a deploy never re-seeds
|--------------------------------------------------------------------------
|
| The migration may only add. The seeded world stands in for a deployed one by
| having the new grants, the driver role and the plain names taken back out.
|
*/

function runRoleJobsMigration(): void
{
    $migration = require dirname(__DIR__).'/database/migrations/2026_11_03_030001_rebuild_template_roles_around_real_jobs.php';
    $migration->up();
}

function roleCodes(Role $role): array
{
    return Permission::query()
        ->whereIn('id', RolePermission::withoutTenancy()->where('role_id', $role->getKey())->select('permission_id'))
        ->pluck('code')
        ->all();
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
});

it('opens the kitchen display and order supervision to a branch manager’s copy', function (): void {
    DB::table('permissions')->where('code', 'order.prepare_organisation')->delete();
    RolePermission::withoutTenancy()->where('role_id', ($this->copy)('branch_manager')->getKey())->delete();

    runRoleJobsMigration();

    expect(roleCodes(($this->copy)('branch_manager')))->toContain(
        'order.prepare_organisation',
        'order.view_organisation',
        'order.manage_organisation',
        'order.supervise_organisation',
    );
});

it('gives the wall to the chef and the cook and not the order book', function (string $code): void {
    DB::table('permissions')->where('code', 'order.prepare_organisation')->delete();

    runRoleJobsMigration();

    $codes = roleCodes(($this->copy)($code));

    expect($codes)->toContain('order.prepare_organisation')
        ->and($codes)->not->toContain('order.view_organisation');
})->with(['kitchen_chef', 'kitchen_staff']);

it('takes no grant away from anybody', function (): void {
    $before = RolePermission::withoutTenancy()->pluck('permission_id', 'id')->all();

    runRoleJobsMigration();

    expect(RolePermission::withoutTenancy()->pluck('permission_id', 'id')->all())->toMatchArray($before);
});

it('stamps a driver role into a kitchen that predates it', function (): void {
    ($this->copy)('kitchen_driver')->delete();
    Role::withoutTenancy()->whereNull('organisation_id')->where('code', 'kitchen_driver')->delete();

    runRoleJobsMigration();

    expect(roleCodes(($this->copy)('kitchen_driver')))->toContain('organisation.view_current');
});

it('renames a copy nobody renamed and leaves a kitchen’s own wording alone', function (): void {
    $untouched = ($this->copy)('order_desk_agent');
    $untouched->forceFill(['name_en' => 'Order desk agent', 'description_en' => null])->save();

    $renamed = ($this->copy)('kitchen_staff');
    $renamed->forceFill(['name_en' => 'Line hand', 'description_en' => 'Our words.'])->save();

    runRoleJobsMigration();

    expect($untouched->fresh()->name_en)->toBe('Cashier')
        ->and($untouched->fresh()->description_en)->not->toBeNull()
        ->and($renamed->fresh()->name_en)->toBe('Line hand')
        ->and($renamed->fresh()->description_en)->toBe('Our words.');
});

it('leaves a role a kitchen made itself alone, whatever it is called', function (): void {
    Role::withoutTenancy()->where('organisation_id', $this->kitchen->getKey())->where('code', 'branch_manager')->delete();

    $own = Role::factory()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'code' => 'branch_manager',
        'name_en' => 'Branch manager',
        'is_system' => false,
        'created_by' => User::factory()->create()->getKey(),
    ]);

    runRoleJobsMigration();

    expect(roleCodes($own))->toBe([]);
});

it('runs twice without changing anything', function (): void {
    runRoleJobsMigration();

    $roles = Role::withoutTenancy()->count();
    $grants = RolePermission::withoutTenancy()->count();

    runRoleJobsMigration();

    expect(Role::withoutTenancy()->count())->toBe($roles)
        ->and(RolePermission::withoutTenancy()->count())->toBe($grants);
});
