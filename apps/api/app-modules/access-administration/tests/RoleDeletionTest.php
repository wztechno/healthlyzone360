<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Deleting a role nobody holds
|--------------------------------------------------------------------------
|
| The guard here exists because of a cascade. `membership_roles` is
| `cascadeOnDelete` on `role_id`, so the database would take a role away from
| six people without a word — which is the silent revocation this whole module
| exists to make impossible. The endpoint therefore counts holders first and
| refuses with the number, so the console can say "reassign these six" rather
| than "no".
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('refuses to delete a role somebody still holds, and says how many', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');

    $this->actingAs($tenant->user)
        ->deleteJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$cook->role->getKey()}",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.membership_count', 1)
        ->assertJsonPath('error.details.membership_ids', [(string) $cook->membership->getKey()]);

    expect(Role::withoutTenancy()->whereKey($cook->role->getKey())->exists())->toBeTrue();
});

it('deletes a role nobody holds and takes its grants with it', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $spare = AccessWorld::role($tenant->organisation, 'spare', ['order.view_organisation']);

    $this->actingAs($tenant->user)
        ->deleteJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$spare->getKey()}",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertNoContent();

    expect(Role::withoutTenancy()->whereKey($spare->getKey())->exists())->toBeFalse()
        // A real delete, not a soft one: there are none on this platform, and
        // a role nobody holds granting nothing to anybody is a row with no
        // remaining meaning.
        ->and(RolePermission::withoutTenancy()->where('role_id', $spare->getKey())->exists())->toBeFalse();
});

it('deletes the role once the last holder has been reassigned', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');
    $replacement = AccessWorld::role($tenant->organisation, 'prep', ['recipe.view_organisation']);

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [['role_id' => (string) $replacement->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk();

    $this->actingAs($tenant->user)
        ->deleteJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$cook->role->getKey()}",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertNoContent();

    expect(MembershipRole::withoutTenancy()->where('membership_id', $cook->membership->getKey())->count())->toBe(1);
});

it('refuses a delete carrying a stale validator', function (): void {
    // The sharper version of the update's problem: somebody may have granted
    // this role to a new starter since the list was read, and a delete that
    // ignored the version would take it straight back off them.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $spare = AccessWorld::role($tenant->organisation, 'spare', []);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$spare->getKey()}",
            ['name_en' => 'Spare', 'name_ar' => 'احتياطي', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk();

    $this->actingAs($tenant->user)
        ->deleteJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$spare->getKey()}",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertStatus(409)
        ->assertJsonPath('error.details.current_lock_version', 1);

    expect(Role::withoutTenancy()->whereKey($spare->getKey())->exists())->toBeTrue();
});
