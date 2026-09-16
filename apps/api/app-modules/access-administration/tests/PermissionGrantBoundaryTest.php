<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| What a tenant's role may never hold
|--------------------------------------------------------------------------
|
| `PermissionRegistryTest` proves the *seeder* cannot build a template role
| from a platform code, because `templateRoles()` is assembled from
| `organisationPermissions()` alone. That argument stops working the moment a
| tenant can write a grant by hand, which is what AA1 makes possible — so this
| file is the same invariant re-proved at the one place it could otherwise be
| broken from outside.
|
| The claim has three parts, and each fails differently:
|
| - **a platform code is refused**, however the caller is privileged. An
|   organisation role holding `reference.manage_platform` would be a tenant
|   editing the allergen vocabulary every other tenant shares.
| - **a non-assignable code is refused**, because
|   `PermissionChecker::calculatedPermissions()` drops those when it computes
|   what somebody may do — so a role carrying one would appear to grant an
|   authority and would not.
| - **the catalogue offers neither**, so the form never shows a checkbox the
|   server is obliged to reject.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('refuses a platform code on a new role and names the field', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'shadow_operator',
                'name_en' => 'Shadow operator',
                'name_ar' => 'مشغل',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['order.view_organisation', 'reference.manage_platform'],
            ],
            AccessWorld::headers($tenant),
        )
        // A 422, not a 403, and the distinction is the point: nothing is wrong
        // with who is asking — the caller may manage roles perfectly well —
        // what is wrong is the body, so a form can put the message beside the
        // checkbox that caused it.
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.refused_codes', ['reference.manage_platform']);
});

it('refuses a platform code on an existing role too', function (): void {
    // The boundary has to hold on every write path, not only on creation —
    // which is why it lives in `GrantBoundary` rather than in a form request.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', ['recipe.view_organisation']);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$role->getKey()}",
            [
                'name_en' => 'Line cook',
                'name_ar' => 'طاهٍ',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['recipe.view_organisation', 'organisation.manage_platform'],
            ],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertStatus(422)
        ->assertJsonPath('error.details.refused_codes', ['organisation.manage_platform']);

    // And nothing was written on the way to being refused.
    expect(RolePermission::withoutTenancy()->where('role_id', $role->getKey())->count())->toBe(1);
});

it('refuses a code the checker would drop anyway', function (): void {
    // `is_assignable` is not decoration. A role carrying an unassignable code
    // reads as granting an authority and grants nothing, which is the worst
    // shape an access console can produce.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    Permission::query()->where('code', 'audit.view_organisation')->update(['is_assignable' => false]);

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'auditor',
                'name_en' => 'Auditor',
                'name_ar' => 'مدقق',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['audit.view_organisation'],
            ],
            AccessWorld::headers($tenant),
        )
        ->assertStatus(422)
        ->assertJsonPath('error.details.refused_codes', ['audit.view_organisation']);
});

it('keeps an unassignable code out of the catalogue as well as out of a role', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    Permission::query()->where('code', 'audit.view_organisation')->update(['is_assignable' => false]);

    $codes = collect(
        $this->actingAs($tenant->user)
            ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/permissions", AccessWorld::headers($tenant))
            ->assertOk()
            ->json('data.domains')
    )->flatMap(fn (array $domain): array => array_column($domain['permissions'], 'code'))->all();

    expect($codes)->not->toContain('audit.view_organisation');
});

it('lets an administrator grant a code they do not hold themselves', function (): void {
    // AA1's deliberate answer: role management is total. The refusal, if this
    // is ever revisited, belongs in `GrantBoundary::assertMayGrant()` and
    // nowhere else — which is why this test names that method's behaviour
    // rather than the endpoint's.
    $tenant = AccessWorld::kitchen('narrow@verdant.test', [
        'organisation.view_current',
        'role.view_organisation',
        'role.manage_organisation',
    ]);

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'accountant',
                'name_en' => 'Accountant',
                'name_ar' => 'محاسب',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['inventory.view_costs_organisation'],
            ],
            AccessWorld::headers($tenant),
        )
        ->assertCreated()
        ->assertJsonPath('data.role.permissions', ['inventory.view_costs_organisation']);
});
