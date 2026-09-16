<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\PlatformAdministration\Services\MembershipGranter;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| A platform template is readable, copyable, and not editable
|--------------------------------------------------------------------------
|
| `RolePolicy::additionalConditions` has refused to manage an `is_system` role
| since the foundation and, until AA1, was never invoked from HTTP by anything.
| This file is the first thing that proves the rule reaches a request — and the
| reason the console offers **Copy** on a template rather than Edit.
|
| The second half pins the behaviour Copy relies on: a kitchen may define a role
| carrying a template's code, and `MembershipGranter::role()` documents
| preferring the tenant's own. That is not an accident to be tolerated, it is
| the mechanism, so it is asserted rather than left to be rediscovered.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('refuses to edit a platform template, however many permissions the caller holds', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$template->getKey()}",
            ['name_en' => 'Mine now', 'name_ar' => 'لي', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        // 404, not 403: from the writing side there is no role at this
        // identifier that belongs to you, and that is the honest answer.
        // `RolePolicy` and the `roles` RLS policy refuse it twice more behind
        // this, neither of which can give as good a message.
        ->assertNotFound();

    expect((string) Role::withoutTenancy()->whereKey($template->getKey())->value('name_en'))
        ->toBe('Kitchen manager');
});

it('refuses to delete a platform template', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('order_desk_agent');

    $this->actingAs($tenant->user)
        ->deleteJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$template->getKey()}",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertNotFound();

    expect(Role::withoutTenancy()->whereKey($template->getKey())->exists())->toBeTrue();
});

it('refuses a template through the policy even when the locator is bypassed', function (): void {
    // The locator answers 404 first, so the policy's own refusal would never
    // run in a request. It is asserted directly because it is the layer a
    // future condition gets added to, and a rule nothing exercises is a rule
    // that quietly stops working.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');

    app(TenantContext::class)
        ->setOrganisation((string) $tenant->user->getKey(), (string) $tenant->organisation->getKey(), $tenant->membership);

    expect($tenant->user->can('update', $template))->toBeFalse()
        ->and($tenant->user->can('update', AccessWorld::role($tenant->organisation, 'ours', [])))->toBeTrue();
});

it('lets a kitchen copy a template into a role of its own and edit that', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_staff');

    $source = $this->actingAs($tenant->user)
        ->getJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$template->getKey()}",
            AccessWorld::headers($tenant),
        )
        ->assertOk()
        ->json('data.role');

    $copy = $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles",
            [
                'code' => 'kitchen_staff_evening',
                'name_en' => $source['name_en'].' (evenings)',
                'name_ar' => $source['name_ar'],
                'description_en' => null,
                'description_ar' => null,
                'permissions' => $source['permissions'],
            ],
            AccessWorld::headers($tenant),
        )
        ->assertCreated()
        ->json('data.role');

    expect($copy['permissions'])->toBe($source['permissions'])
        ->and($copy['is_system'])->toBeFalse();

    // And the copy is editable, which is the whole point of making one.
    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$copy['id']}",
            [
                'name_en' => 'Evening kitchen staff',
                'name_ar' => 'طاقم المساء',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => ['recipe.view_organisation'],
            ],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk()
        ->assertJsonPath('data.role.permissions', ['recipe.view_organisation']);
});

it('prefers the kitchen’s own role over the template of the same code when an invitation is accepted', function (): void {
    // The documented behaviour Copy depends on, and the reason a shadowing code
    // is reported rather than refused. Asserted here so that a change to
    // `MembershipGranter::role()` breaks a test that explains why it mattered.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $bespoke = AccessWorld::role($tenant->organisation, 'kitchen_staff', ['recipe.view_organisation']);

    $acceptor = User::factory()->create(['email' => 'newstarter@verdant.test']);

    $invitation = OrganisationInvitation::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'email' => 'newstarter@verdant.test',
        'email_normalised' => 'newstarter@verdant.test',
        'role_code' => 'kitchen_staff',
        'invited_by' => $tenant->user->getKey(),
    ]);

    $membershipId = app(MembershipGranter::class)->grant($invitation, $acceptor);

    expect($membershipId)->not->toBeNull();

    $assignedRoleId = (string) MembershipRole::withoutTenancy()
        ->where('membership_id', $membershipId)
        ->value('role_id');

    expect($assignedRoleId)->toBe((string) $bespoke->getKey())
        ->and($assignedRoleId)->not->toBe((string) AccessWorld::template('kitchen_staff')->getKey());
});
