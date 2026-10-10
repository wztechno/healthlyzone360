<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The one thing this console will not let you do to yourself
|--------------------------------------------------------------------------
|
| PA1 lets the platform revoke a kitchen's last owner, and is right to: it acts
| from *outside*, so whatever it breaks it can still reach in and fix. A tenant
| administrator is inside the room, and there is no screen in this product that
| can give them back an authority they have just taken from themselves — the
| next request is refused by the same middleware that would have let them undo
| it.
|
| So exactly three things are refused, all of them self-inflicted:
|
|   - removing `role.manage_organisation` from a role the caller holds, when no
|     other role of theirs carries it;
|   - removing it from their own membership by replacing their role set;
|   - ending or suspending their own membership.
|
| And one thing is deliberately **not** refused: removing the last *other*
| administrator. That is reported through `meta.remaining_role_administrators`
| and nothing else, because a console that refused the thing an operator opened
| it to do is a control that has made itself unusable. Both halves are pinned
| here, because the asymmetry is the design and a future hand might "fix" it.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('refuses to strip role management from the caller’s own role', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$tenant->role->getKey()}",
            [
                'name_en' => 'Administrator',
                'name_ar' => 'مدير',
                'description_en' => null,
                'description_ar' => null,
                // Everything except the one code that lets them come back.
                'permissions' => array_values(array_diff(AccessWorld::ADMINISTRATOR_PERMISSIONS, ['role.manage_organisation'])),
            ],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        // A 409, not a 403. The caller *may* do this; what stops them is that
        // doing it to themselves leaves the organisation a way in short.
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'access.self_lockout')
        ->assertJsonPath('error.details.reason', 'role_management_removed_from_own_role');
});

it('permits the same edit when a second role of the caller’s still carries it', function (): void {
    // The guard is about the caller's *effective* set, not about this role in
    // isolation — otherwise an administrator with two roles could never tidy
    // either of them.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $spare = AccessWorld::role($tenant->organisation, 'keyholder', ['role.manage_organisation']);

    MembershipRole::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'membership_id' => $tenant->membership->getKey(),
        'role_id' => $spare->getKey(),
    ]);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$tenant->role->getKey()}",
            [
                'name_en' => 'Administrator',
                'name_ar' => 'مدير',
                'description_en' => null,
                'description_ar' => null,
                'permissions' => array_values(array_diff(AccessWorld::ADMINISTRATOR_PERMISSIONS, ['role.manage_organisation'])),
            ],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk();
});

it('permits stripping role management from somebody else’s role', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $deputy = AccessWorld::colleague($tenant, 'deputy@verdant.test', ['role.manage_organisation'], 'deputy');

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/roles/{$deputy->role->getKey()}",
            ['name_en' => 'Deputy', 'name_ar' => 'نائب', 'description_en' => null, 'description_ar' => null, 'permissions' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk();
});

it('refuses to re-role the caller out of role management', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::role($tenant->organisation, 'line_cook', ['recipe.view_organisation']);

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$tenant->membership->getKey()}/roles",
            ['roles' => [['role_id' => (string) $cook->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'role_management_removed_from_own_membership');
});

it('counts a role that has not started yet as one the caller holds', function (): void {
    // The mirror case the bounds exist for. A guard that counted only
    // currently-effective roles would let an administrator schedule their own
    // to expire tonight — the lock-out this file exists to prevent, arriving on
    // a timer.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$tenant->membership->getKey()}/roles",
            ['roles' => [[
                'role_id' => (string) $tenant->role->getKey(),
                'starts_at' => now()->addWeek()->toIso8601String(),
            ]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk();
});

it('refuses to end the caller’s own membership', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$tenant->membership->getKey()}/end",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'access.self_lockout')
        ->assertJsonPath('error.details.reason', 'end_own_membership');

    expect(OrganisationMembership::withoutTenancy()->whereKey($tenant->membership->getKey())->value('status'))
        ->not->toBe(MembershipStatus::Ended->value);
});

it('refuses to suspend the caller’s own membership', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$tenant->membership->getKey()}/suspend",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertStatus(409)
        ->assertJsonPath('error.details.reason', 'suspend_own_membership');
});

it('ends another administrator, and reports how many are left', function (): void {
    // The asymmetry, stated as a test. This is permitted on purpose: the API
    // returns the consequence and the console warns — PA1's `remaining_owners`
    // shape, because a control that refuses the operator's whole reason for
    // opening it is a control nobody can use.
    //
    // The count excludes the membership being acted on and nothing else, so it
    // reads as "how many administrators will this organisation have when this
    // is done". The caller is one of them: a warning that said "none left" to
    // somebody who is themselves an administrator would be a warning nobody
    // could act on.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $deputy = AccessWorld::colleague($tenant, 'deputy@verdant.test', ['role.manage_organisation'], 'deputy');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$deputy->membership->getKey()}/end",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $deputy->membership->lock_version),
        )
        ->assertOk()
        ->assertJsonPath('data.membership.status', 'ended')
        ->assertJsonPath('meta.remaining_role_administrators', 1);
});

it('tells a sole administrator that nobody else can administer access', function (): void {
    // The only way the count reaches zero, and the case the warning exists for.
    // The subject is excluded, so an administrator reading their own row is
    // being told "nobody else" — which is exactly what they need to know before
    // they go on holiday, and the one thing a count that included them could
    // never say.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');

    $this->actingAs($tenant->user)
        ->getJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$tenant->membership->getKey()}",
            AccessWorld::headers($tenant),
        )
        ->assertOk()
        ->assertJsonPath('meta.remaining_role_administrators', 0);
});

it('does not count a suspended administrator as one the organisation has', function (): void {
    // A suspended administrator cannot sign in, so counting them would report
    // an administrator the organisation does not currently have — the one
    // answer this number must never give.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $deputy = AccessWorld::colleague($tenant, 'deputy@verdant.test', ['role.manage_organisation'], 'deputy');
    $reserve = AccessWorld::colleague($tenant, 'reserve@verdant.test', ['role.manage_organisation'], 'reserve');

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$reserve->membership->getKey()}/suspend",
            [],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $reserve->membership->lock_version),
        )
        ->assertOk();

    $this->actingAs($tenant->user)
        ->getJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$deputy->membership->getKey()}",
            AccessWorld::headers($tenant),
        )
        ->assertOk()
        // The caller and the suspended reserve are both excluded: one by the
        // question, one by being unable to sign in.
        ->assertJsonPath('meta.remaining_role_administrators', 1);
});
