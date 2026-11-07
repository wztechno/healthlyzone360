<?php

declare(strict_types=1);

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
| cook's grant: the permission and every other holder stay.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $kitchen = Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);

    app(OrganisationRoles::class)->provision((string) $kitchen->getKey());

    $this->holds = fn (string $code): bool => RolePermission::withoutTenancy()
        ->where('role_id', Role::withoutTenancy()->where('organisation_id', $kitchen->getKey())->where('code', $code)->sole()->getKey())
        ->where('permission_id', Permission::query()->where('code', 'production.view_organisation')->sole()->getKey())
        ->exists();

    $this->migration = require dirname(__DIR__).'/database/migrations/2026_11_08_000001_grant_kitchen_staff_production_view.php';
});

it('gives the cook the batch read and takes back only that on the way down', function (): void {
    $this->migration->down();

    expect(($this->holds)('kitchen_staff'))->toBeFalse()
        ->and(($this->holds)('kitchen_chef'))->toBeTrue();

    $this->migration->up();
    $this->migration->up();

    expect(($this->holds)('kitchen_staff'))->toBeTrue()
        ->and(($this->holds)('kitchen_chef'))->toBeTrue();
});
