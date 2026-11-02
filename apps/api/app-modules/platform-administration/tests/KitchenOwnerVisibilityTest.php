<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\OrganisationRoles;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\PlatformAdministration\Services\KitchenOverviewQuery;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;

/*
|--------------------------------------------------------------------------
| The console sees a kitchen's owner
|--------------------------------------------------------------------------
|
| Run under the runtime role with the operator's context, because the bug only
| exists there: the migrator bypasses row-level security, so every older test
| saw the owner the console could not.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $kitchenType = OrganisationType::query()->where('code', 'kitchen')->sole()->getKey();
    $attributes = ['country_code' => 'LB', 'default_currency_code' => 'USD', 'default_language_code' => 'en'];

    $this->operator = Organisation::factory()->create(['organisation_type_id' => $kitchenType, ...$attributes]);
    $this->kitchen = Organisation::factory()->create(['organisation_type_id' => $kitchenType, ...$attributes]);

    app(OrganisationRoles::class)->provision((string) $this->kitchen->getKey());

    $this->owner = OrganisationMembership::withoutTenancy()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'user_id' => User::factory()->create()->getKey(),
        'status' => MembershipStatus::Active,
        'lock_version' => 0,
    ]);
});

function holdRole(object $test, Role $role): void
{
    MembershipRole::withoutTenancy()->create([
        'organisation_id' => $test->kitchen->getKey(),
        'membership_id' => $test->owner->getKey(),
        'role_id' => $role->getKey(),
    ]);
}

function ownersAsTheOperator(object $test): array
{
    RuntimeRole::context(null, (string) $test->operator->getKey());

    return RuntimeRole::run(fn (): array => app(KitchenOverviewQuery::class)->ownersOf($test->kitchen));
}

it('finds an owner on the kitchen’s own copy of the role', function (): void {
    holdRole($this, Role::withoutTenancy()
        ->where('organisation_id', $this->kitchen->getKey())
        ->where('code', 'organisation_owner')
        ->sole());

    expect(ownersAsTheOperator($this))->toHaveCount(1);
});

it('finds an owner the role split moved onto a standard copy', function (): void {
    holdRole($this, Role::factory()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'code' => 'organisation_owner_standard',
        'is_system' => false,
    ]));

    expect(ownersAsTheOperator($this))->toHaveCount(1);
});

it('does not take a lookalike role for an owner', function (): void {
    holdRole($this, Role::factory()->create([
        'organisation_id' => $this->kitchen->getKey(),
        'code' => 'organisation_owner_assistant',
        'is_system' => false,
    ]));

    expect(ownersAsTheOperator($this))->toBe([]);
});
