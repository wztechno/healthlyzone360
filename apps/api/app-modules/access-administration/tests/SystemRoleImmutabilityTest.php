<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\OrganisationRoles;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\PlatformAdministration\Services\MembershipGranter;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Every kitchen owns its roles; the platform templates are blueprints
|--------------------------------------------------------------------------
|
| The standard roles used to be one shared row per code, assigned directly by
| every kitchen, so none of them could be edited. Now each organisation gets
| its own copy of every template when it is created
| (`OrganisationRoles::provision()`), every copy is editable, and an edit stays
| inside the kitchen that made it. The templates themselves are never served to
| a tenant and still refuse every write.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('gives an organisation its own editable copy of every standard role, with the template’s grants', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    app(OrganisationRoles::class)->provision((string) $tenant->organisation->getKey());

    foreach (PermissionRegistry::templateRoles() as $code => $template) {
        $copy = AccessWorld::own($tenant, $code);

        $granted = RolePermission::withoutTenancy()
            ->where('role_id', $copy->getKey())
            ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
            ->pluck('permissions.code')
            ->sort()
            ->values()
            ->all();

        expect($copy->is_system)->toBeFalse()
            ->and($granted)->toBe(collect($template['permissions'])->sort()->values()->all());
    }

    // Idempotent: a second run finds every code taken and writes nothing.
    $before = Role::withoutTenancy()->where('organisation_id', $tenant->organisation->getKey())->count();
    app(OrganisationRoles::class)->provision((string) $tenant->organisation->getKey());

    expect(Role::withoutTenancy()->where('organisation_id', $tenant->organisation->getKey())->count())->toBe($before);
});

it('lists the kitchen’s own roles only — never the platform templates', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    app(OrganisationRoles::class)->provision((string) $tenant->organisation->getKey());

    $roles = $this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/roles", AccessWorld::headers($tenant))
        ->assertOk()
        ->json('data');

    $ids = array_column($roles, 'id');

    expect($ids)->toContain((string) AccessWorld::own($tenant, 'kitchen_chef')->getKey())
        ->and($ids)->not->toContain((string) AccessWorld::template('kitchen_chef')->getKey())
        ->and(array_unique(array_column($roles, 'is_system')))->toBe([false]);
});

it('lets a kitchen edit its standard roles without touching any other kitchen’s', function (): void {
    $verdant = AccessWorld::kitchen('admin@verdant.test');
    $cedar = AccessWorld::kitchen('admin@cedar.test');
    app(OrganisationRoles::class)->provision((string) $verdant->organisation->getKey());
    app(OrganisationRoles::class)->provision((string) $cedar->organisation->getKey());

    $chef = AccessWorld::own($verdant, 'kitchen_chef');

    $this->actingAs($verdant->user)
        ->patchJson(
            "/api/v1/organisations/{$verdant->organisation->getKey()}/roles/{$chef->getKey()}",
            [
                'name_en' => 'Head chef',
                'name_ar' => 'رئيس الطهاة',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['recipe.view_organisation'],
            ],
            AccessWorld::headers($verdant) + AccessWorld::ifMatch(0),
        )
        ->assertOk()
        ->assertJsonPath('data.role.name_en', 'Head chef')
        ->assertJsonPath('data.role.permissions', ['recipe.view_organisation']);

    $theirs = AccessWorld::own($cedar, 'kitchen_chef');
    $template = AccessWorld::template('kitchen_chef');

    expect($theirs->name_en)->toBe($template->name_en)
        ->and(RolePermission::withoutTenancy()->where('role_id', $theirs->getKey())->count())
        ->toBe(RolePermission::withoutTenancy()->where('role_id', $template->getKey())->count());
});

it('lets a kitchen delete a standard role nobody holds', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    app(OrganisationRoles::class)->provision((string) $tenant->organisation->getKey());

    $desk = AccessWorld::own($tenant, 'order_desk_agent');

    $this->actingAs($tenant->user)
        ->deleteJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$desk->getKey()}",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertSuccessful();

    expect(Role::withoutTenancy()->whereKey($desk->getKey())->exists())->toBeFalse()
        ->and(AccessWorld::template('order_desk_agent')->exists)->toBeTrue();
});

it('never serves, edits or deletes a platform template', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');
    $path = "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$template->getKey()}";

    $this->actingAs($tenant->user)->getJson($path, AccessWorld::headers($tenant))->assertNotFound();

    $this->actingAs($tenant->user)
        ->patchJson(
            $path,
            ['name_en' => 'Mine now', 'name_ar' => 'لي', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertNotFound();

    $this->actingAs($tenant->user)
        ->deleteJson($path, [], AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertNotFound();

    expect((string) Role::withoutTenancy()->whereKey($template->getKey())->value('name_en'))->toBe('Kitchen manager');
});

it('refuses a template through the policy even when the locator is bypassed', function (): void {
    // The locator answers 404 first, so the policy's own refusal would never
    // run in a request. It is asserted directly because it is the layer a
    // future condition gets added to.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');

    app(TenantContext::class)
        ->setOrganisation((string) $tenant->user->getKey(), (string) $tenant->organisation->getKey(), $tenant->membership);

    expect($tenant->user->can('update', $template))->toBeFalse()
        ->and($tenant->user->can('update', AccessWorld::role($tenant->organisation, 'ours', [])))->toBeTrue();
});

it('grants the kitchen’s own role when an invitation is accepted, never the template', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    app(OrganisationRoles::class)->provision((string) $tenant->organisation->getKey());

    $acceptor = User::factory()->create(['email' => 'newstarter@verdant.test']);

    $invitation = OrganisationInvitation::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'email' => 'newstarter@verdant.test',
        'email_normalised' => 'newstarter@verdant.test',
        'role_code' => 'kitchen_staff',
        'invited_by' => $tenant->user->getKey(),
    ]);

    $membershipId = app(MembershipGranter::class)->grant($invitation, $acceptor);

    $assignedRoleId = (string) MembershipRole::withoutTenancy()
        ->where('membership_id', $membershipId)
        ->value('role_id');

    expect($assignedRoleId)->toBe((string) AccessWorld::own($tenant, 'kitchen_staff')->getKey());
});

it('grants nothing for a role the kitchen deleted, rather than falling back to the template', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $acceptor = User::factory()->create(['email' => 'newstarter@verdant.test']);

    $invitation = OrganisationInvitation::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'email' => 'newstarter@verdant.test',
        'email_normalised' => 'newstarter@verdant.test',
        'role_code' => 'kitchen_staff',
        'invited_by' => $tenant->user->getKey(),
    ]);

    expect(app(MembershipGranter::class)->grant($invitation, $acceptor))->toBeNull();
});
