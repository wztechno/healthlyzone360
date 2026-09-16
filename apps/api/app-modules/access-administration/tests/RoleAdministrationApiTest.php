<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The role console, end to end
|--------------------------------------------------------------------------
|
| AA1's read and write surface for `roles`, plus the vocabulary endpoint the
| editor is written against. What is pinned here is the *contract* — status
| codes, the shape of a page, the concurrency handshake — rather than the
| authorisation rules, which have their own files beside this one so a failure
| says which of the two broke.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('serves the organisation vocabulary and never a platform code', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $response = $this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/permissions", AccessWorld::headers($tenant))
        ->assertOk();

    $codes = collect($response->json('data.domains'))
        ->flatMap(fn (array $domain): array => array_column($domain['permissions'], 'code'))
        ->all();

    // The security property, not a filter: the registry is split so that no
    // organisation role can hold a platform code, and a catalogue offering one
    // would be a form with a trap in it.
    expect($codes)->toContain('role.manage_organisation')
        ->and($codes)->toContain('inventory.view_costs_organisation')
        ->and($codes)->not->toContain('organisation.manage_platform')
        ->and($codes)->not->toContain('reference.manage_platform')
        ->and($codes)->not->toContain('b2b_offboarding.waive_settlement_platform');
});

it('marks the codes the caller does not hold themselves', function (): void {
    // AA1 ships no escalation guard, so this is information rather than a gate:
    // the editor annotates what an administrator is granting beyond their own
    // reach instead of hiding it.
    $tenant = AccessWorld::kitchen('narrow@verdant.test', AccessWorld::VIEWER_PERMISSIONS + ['role.manage_organisation']);

    $response = $this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/permissions", AccessWorld::headers($tenant))
        ->assertOk();

    $byCode = collect($response->json('data.domains'))
        ->flatMap(fn (array $domain): array => $domain['permissions'])
        ->keyBy('code');

    expect($byCode['role.view_organisation']['held_by_caller'])->toBeTrue()
        ->and($byCode['inventory.view_costs_organisation']['held_by_caller'])->toBeFalse();
});

it('lists the platform templates beside the kitchen’s own roles', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $response = $this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/roles", AccessWorld::headers($tenant))
        ->assertOk();

    $rows = collect($response->json('data'))->keyBy('code');

    // Both kinds in one list, because from the *assigning* side they are one
    // set — an administrator picking a role for somebody may pick either.
    expect($rows->has('kitchen_manager'))->toBeTrue()
        ->and($rows['kitchen_manager']['is_system'])->toBeTrue()
        ->and($rows['administrator']['is_system'])->toBeFalse()
        // Templates first: the standard role is what a person is usually
        // looking for, and the bespoke ones are the exceptions read after it.
        ->and($response->json('data.0.is_system'))->toBeTrue();

    // The number that makes the list actionable, and the one that decides
    // whether Delete will be refused.
    expect($rows['administrator']['holder_count'])->toBe(1)
        ->and($rows['administrator']['permission_count'])->toBe(count(AccessWorld::ADMINISTRATOR_PERMISSIONS));
});

it('reads a platform template so it can be copied', function (): void {
    // `visibleRole`, not `ownRole`. Copy is the only supported way for a
    // kitchen to change what a template means inside its own walls, so a read
    // that 404'd here would make that impossible.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');

    $this->actingAs($tenant->user)
        ->getJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$template->getKey()}",
            AccessWorld::headers($tenant),
        )
        ->assertOk()
        ->assertJsonPath('data.role.is_system', true)
        ->assertJsonPath('data.role.code', 'kitchen_manager')
        // The grant set is what Copy needs, so the read has to carry it in
        // full — a summary here would make the affordance unbuildable.
        ->assertJsonPath('data.role.permission_count', count(PermissionRegistry::templateRoles()['kitchen_manager']['permissions']));
});

it('creates a role and serves its validator as an ETag', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $response = $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'evening_counter',
                'name_en' => 'Evening counter',
                'name_ar' => 'كاونتر المساء',
                'description_en' => 'Works the till after five.',
                'description_ar' => null,
                'permissions' => ['order.view_organisation', 'order.manage_organisation'],
            ],
            AccessWorld::headers($tenant),
        )
        ->assertCreated()
        ->assertJsonPath('data.role.code', 'evening_counter')
        ->assertJsonPath('data.role.is_system', false)
        ->assertJsonPath('data.role.holder_count', 0)
        ->assertJsonPath('meta.shadows_template', false);

    expect($response->headers->get('ETag'))->toBe('"0"')
        // Catalogue order, not submission order, so two saves that changed
        // nothing produce the same rows.
        ->and($response->json('data.role.permissions'))->toBe([
            'order.manage_organisation',
            'order.view_organisation',
        ]);
});

it('reports a bespoke role that shadows a platform template', function (): void {
    // Permitted, because `MembershipGranter::role()` documents preferring a
    // tenant's own role over the template of the same code — which is what
    // makes Copy work. Reported, because a kitchen that did it on purpose and
    // one that did it by accident type exactly the same thing.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'kitchen_manager',
                'name_en' => 'Kitchen manager',
                'name_ar' => 'مدير المطبخ',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['order.view_organisation'],
            ],
            AccessWorld::headers($tenant),
        )
        ->assertCreated()
        ->assertJsonPath('meta.shadows_template', true);
});

it('refuses a second role with a code this kitchen already uses', function (): void {
    // The natural key the store endpoint relies on instead of an idempotency
    // key: `roles_organisation_id_code_unique NULLS NOT DISTINCT`.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'administrator',
                'name_en' => 'Administrator again',
                'name_ar' => 'مدير',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => [],
            ],
            AccessWorld::headers($tenant),
        )
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('replaces a role’s grants rather than merging them', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', [
        'recipe.view_organisation',
        'catalogue.view_organisation',
    ]);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$role->getKey()}",
            [
                'name_en' => 'Line cook',
                'name_ar' => 'طاهٍ',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['recipe.view_organisation'],
            ],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk()
        // The withdrawn code is gone. An additive API could not express this,
        // and taking things away is the half that matters.
        ->assertJsonPath('data.role.permissions', ['recipe.view_organisation'])
        ->assertJsonPath('data.role.lock_version', 1);
});

it('demands an If-Match on every role write', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', []);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$role->getKey()}",
            ['name_en' => 'x', 'name_ar' => 'x', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant),
        )
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');
});

it('refuses a write carrying the version somebody else has already superseded', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', []);

    $url = "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$role->getKey()}";
    $body = ['name_en' => 'Line cook', 'name_ar' => 'طاهٍ', 'description_en' => null, 'description_ar' => null, 'permissions' => []];

    $this->actingAs($tenant->user)->patchJson($url, $body, AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))->assertOk();

    // The second administrator, still holding the validator they read.
    $this->actingAs($tenant->user)
        ->patchJson($url, $body, AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.current_lock_version', 1);
});

it('answers 404 for another kitchen’s role', function (): void {
    // "No such role, as far as you are concerned" — a 403 would confirm that
    // another tenant has one at this identifier.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $stranger = AccessWorld::kitchen('admin@rival.test');
    $theirs = AccessWorld::role($stranger->organisation, 'secret', []);

    $this->actingAs($tenant->user)
        ->getJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$theirs->getKey()}",
            AccessWorld::headers($tenant),
        )
        ->assertNotFound();
});

it('refuses the console to a caller without the role codes', function (): void {
    $tenant = AccessWorld::kitchen('cook@verdant.test', ['organisation.view_current']);

    $this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/roles", AccessWorld::headers($tenant))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied');
});

it('lets a viewer read roles and not write them', function (): void {
    $tenant = AccessWorld::kitchen('viewer@verdant.test', AccessWorld::VIEWER_PERMISSIONS);
    $role = AccessWorld::role($tenant->organisation, 'line_cook', []);

    $this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/roles", AccessWorld::headers($tenant))
        ->assertOk();

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$role->getKey()}",
            ['name_en' => 'x', 'name_ar' => 'x', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertForbidden();
});

it('records who last changed a role’s grants', function (): void {
    // `created_by` cannot answer the question an access review asks.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', []);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$role->getKey()}",
            ['name_en' => 'Line cook', 'name_ar' => 'طاهٍ', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk();

    expect((string) Role::withoutTenancy()->whereKey($role->getKey())->value('updated_by'))
        ->toBe((string) $tenant->user->getKey());
});
