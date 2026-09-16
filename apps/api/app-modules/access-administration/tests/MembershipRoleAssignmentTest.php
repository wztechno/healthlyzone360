<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Assigning roles, and the change actually reaching the other person
|--------------------------------------------------------------------------
|
| The last test here is the one that matters most and is the easiest to leave
| out. Everything else pins the write; that one pins the *effect* — that a role
| taken away from somebody is gone from their own `/me` on their next request,
| rather than sitting in a cached permission set that stays valid for five more
| minutes. A console whose revocations take effect at some point in the next
| five minutes is not an access control.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('replaces the whole set rather than adding to it', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');
    $desk = AccessWorld::role($tenant->organisation, 'desk', ['order.view_organisation']);

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [['role_id' => (string) $desk->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk()
        ->assertJsonPath('data.membership.permissions', ['order.view_organisation']);

    $held = MembershipRole::withoutTenancy()
        ->where('membership_id', $cook->membership->getKey())
        ->pluck('role_id')
        ->map(strval(...))
        ->all();

    // The old role is gone, not kept alongside. On a permission table the
    // difference between replace and merge is authority nobody granted.
    expect($held)->toBe([(string) $desk->getKey()]);
});

it('strips every role while leaving the person a member', function (): void {
    // A real state — a new starter whose duties have not been decided — and not
    // the same as ending a membership, which is a different endpoint with a
    // different consequence.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk()
        ->assertJsonPath('data.membership.permissions', [])
        ->assertJsonPath('data.membership.status', 'active');

    expect(MembershipRole::withoutTenancy()->where('membership_id', $cook->membership->getKey())->count())->toBe(0);
});

it('writes the time bounds the schema has always carried', function (): void {
    // `starts_at`/`expires_at` have existed since the foundation and nothing
    // wrote them until now: a role that begins on Monday, a cover arrangement
    // that ends on Friday.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', [], 'line_cook');
    $cover = AccessWorld::role($tenant->organisation, 'cover', ['order.manage_organisation']);

    $starts = now()->addDay()->startOfSecond();
    $expires = now()->addWeek()->startOfSecond();

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [[
                'role_id' => (string) $cover->getKey(),
                'starts_at' => $starts->toIso8601String(),
                'expires_at' => $expires->toIso8601String(),
            ]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk();

    $assignment = MembershipRole::withoutTenancy()
        ->where('membership_id', $cook->membership->getKey())
        ->sole();

    expect($assignment->starts_at?->equalTo($starts))->toBeTrue()
        ->and($assignment->expires_at?->equalTo($expires))->toBeTrue()
        // And a role that has not started grants nothing yet — the checker's
        // own rule, which is why the console shows the assignment and the
        // permission list does not.
        ->and($assignment->isCurrentlyEffective())->toBeFalse();
});

it('refuses a window that closes before it opens', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', [], 'line_cook');
    $cover = AccessWorld::role($tenant->organisation, 'cover', []);

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [[
                'role_id' => (string) $cover->getKey(),
                'starts_at' => now()->addWeek()->toIso8601String(),
                'expires_at' => now()->addDay()->toIso8601String(),
            ]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertStatus(422);
});

it('refuses another kitchen’s role', function (): void {
    // Resolved through the tenant scope, so the cross-tenant identifier never
    // becomes a readable row. A 422 rather than a 404 because the caller is
    // addressing a membership they may see — what is wrong is a value in the
    // body.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', [], 'line_cook');
    $stranger = AccessWorld::kitchen('admin@rival.test');
    $theirs = AccessWorld::role($stranger->organisation, 'secret', ['order.manage_organisation']);

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [['role_id' => (string) $theirs->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertStatus(422)
        ->assertJsonPath('error.details.refused_role_ids', [(string) $theirs->getKey()]);
});

it('assigns a platform template as readily as a bespoke role', function (): void {
    // From the assigning side the two are one set, which is why the roles index
    // serves them in one list.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', [], 'line_cook');
    $template = AccessWorld::template('kitchen_staff');

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [['role_id' => (string) $template->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk()
        ->assertJsonPath('data.membership.roles.0.code', 'kitchen_staff')
        ->assertJsonPath('data.membership.roles.0.is_system', true);
});

it('demands the membership’s validator and detects a lost race', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', [], 'line_cook');
    $desk = AccessWorld::role($tenant->organisation, 'desk', []);

    $url = "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles";
    $body = ['roles' => [['role_id' => (string) $desk->getKey()]]];

    $this->actingAs($tenant->user)->putJson($url, $body, AccessWorld::headers($tenant))->assertStatus(428);

    $this->actingAs($tenant->user)
        ->putJson($url, $body, AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertOk()
        // The parent's version is what the two administrators collide on,
        // because `membership_roles` has none of its own.
        ->assertJsonPath('data.membership.lock_version', 1);

    $this->actingAs($tenant->user)
        ->putJson($url, $body, AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertStatus(409);
});

it('refuses role assignment to a caller who may edit memberships but not roles', function (): void {
    // The split the route's gate exists for: where somebody works and what they
    // may do are different authorities.
    $tenant = AccessWorld::kitchen('scheduler@verdant.test', [
        'organisation.view_current',
        'membership.view_organisation',
        'membership.update_organisation',
        'role.view_organisation',
    ]);
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', [], 'line_cook');
    $desk = AccessWorld::role($tenant->organisation, 'desk', []);

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => [['role_id' => (string) $desk->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertForbidden();

    // The same caller may still move them between branches.
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}",
            ['branch_id' => (string) $branch->getKey()],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk()
        ->assertJsonPath('data.membership.branch.id', (string) $branch->getKey());
});

it('reaches the other person’s next request rather than their cached permission set', function (): void {
    // The test this file exists for. `PermissionCache` holds a calculated set
    // for five minutes keyed on a version counter; a bulk delete fires no model
    // events, so without the explicit bump a revoked role would keep working
    // for the rest of that window.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');

    // Warm the cache the way a real request would: the colleague reads their
    // own context and their permissions are computed and stored.
    $this->actingAs($cook->user)
        ->getJson('/api/v1/me', AccessWorld::headers($tenant))
        ->assertOk()
        ->assertJsonPath('data.active_context.permissions', ['recipe.view_organisation']);

    $before = app(PermissionCache::class)->signature((string) $tenant->organisation->getKey());

    $this->actingAs($tenant->user)
        ->putJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}/roles",
            ['roles' => []],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk();

    expect(app(PermissionCache::class)->signature((string) $tenant->organisation->getKey()))->not->toBe($before);

    forgetResolvedGuards();

    $this->actingAs($cook->user)
        ->getJson('/api/v1/me', AccessWorld::headers($tenant))
        ->assertOk()
        ->assertJsonPath('data.active_context.permissions', []);
});
