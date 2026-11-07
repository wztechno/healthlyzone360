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

/*
| The cook's batch read reaches a deployed kitchen, and going back takes only the
| seeded cook copies' grant: the permission, the chef, a role whose code merely
| starts with the cook's, and a cook role a kitchen made itself all keep it.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $kitchen = fn (): Organisation => Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);

    $this->kitchen = $kitchen();
    app(OrganisationRoles::class)->provision((string) $this->kitchen->getKey());

    $this->permission = Permission::query()->where('code', 'production.view_organisation')->sole();

    $this->holds = fn (Role $role): bool => RolePermission::withoutTenancy()
        ->where('role_id', $role->getKey())
        ->where('permission_id', $this->permission->getKey())
        ->exists();

    $this->copy = fn (string $code): Role => Role::withoutTenancy()
        ->where('organisation_id', $this->kitchen->getKey())
        ->where('code', $code)
        ->sole();

    $granted = function (Organisation $organisation, string $code, ?string $createdBy): Role {
        $role = Role::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'code' => $code,
            'is_system' => false,
            'created_by' => $createdBy,
        ]);

        RolePermission::factory()->create([
            'role_id' => $role->getKey(),
            'permission_id' => $this->permission->getKey(),
        ]);

        return $role;
    };

    // Not a cook copy: the regex is anchored, so `_lead` falls outside it.
    $this->lead = $granted($this->kitchen, 'kitchen_staff_lead', null);
    // A kitchen's own role under the cook's code. Codes are unique per kitchen,
    // so it lives in a second one.
    $this->own = $granted($kitchen(), 'kitchen_staff', (string) User::factory()->create()->getKey());

    $this->migration = require dirname(__DIR__).'/database/migrations/2026_11_08_000001_grant_kitchen_staff_production_view.php';
});

it('takes back only the seeded cook copies’ grant on the way down, and gives it again on the way up', function (): void {
    expect(($this->holds)(($this->copy)('kitchen_staff')))->toBeTrue();

    $this->migration->down();

    expect(($this->holds)(($this->copy)('kitchen_staff')))->toBeFalse()
        ->and(($this->holds)(($this->copy)('kitchen_chef')))->toBeTrue()
        ->and(($this->holds)($this->lead))->toBeTrue()
        ->and(($this->holds)($this->own))->toBeTrue()
        ->and(Permission::query()->whereKey($this->permission->getKey())->exists())->toBeTrue();

    $this->migration->up();
    $this->migration->up();

    expect(($this->holds)(($this->copy)('kitchen_staff')))->toBeTrue()
        ->and(($this->holds)(($this->copy)('kitchen_chef')))->toBeTrue();
});
