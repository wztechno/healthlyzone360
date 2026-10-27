<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\B2b\Models\OrganisationInvitation;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\PlatformAdministration\Services\MembershipGranter;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A branch-bound administrator manages their own branch, and only that
|--------------------------------------------------------------------------
|
| An administrator whose membership is scoped to one branch lists, edits and
| grants roles to that branch's people only, places new people in that branch
| only, and cannot change a role definition — a role is shared by every branch,
| so editing one would reach people they do not manage. A whole-kitchen
| administrator is unaffected; the rest of this module's suites are written
| from that side.
|
| Invitations are the back door this file closes twice: an offer from a branch
| manager may not reach somebody who already works elsewhere in the kitchen, nor
| replace another branch's outstanding offer, and accepting one never moves an
| existing membership.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

/** A colleague placed in a branch, or kitchen-wide when `$branchId` is null. */
function placedColleague(object $tenant, string $email, ?string $branchId): object
{
    $colleague = AccessWorld::colleague($tenant, $email, [], 'line_cook_'.substr(md5($email), 0, 6));
    $colleague->membership->forceFill(['branch_id' => $branchId])->save();

    return $colleague;
}

it('lists only the people in the administrator’s own branch', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [$hamra, $quoz] = AccessWorld::bindToBranch($tenant);

    $mine = placedColleague($tenant, 'mine@verdant.test', (string) $hamra->getKey());
    $theirs = placedColleague($tenant, 'theirs@verdant.test', (string) $quoz->getKey());
    $everywhere = placedColleague($tenant, 'owner@verdant.test', null);

    // A team member's summary names its membership `membership_id` (`TeamMemberPresenter`).
    $ids = collect($this->actingAs($tenant->user)
        ->getJson("/api/v1/organisations/{$tenant->organisation->getKey()}/memberships", AccessWorld::headers($tenant))
        ->assertOk()
        ->json('data'))->pluck('membership_id')->all();

    expect($ids)->toContain((string) $mine->membership->getKey())
        ->and($ids)->not->toContain((string) $theirs->membership->getKey())
        ->and($ids)->not->toContain((string) $everywhere->membership->getKey());
});

it('answers 404 for somebody in another branch, on reads and on writes', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [, $quoz] = AccessWorld::bindToBranch($tenant);
    $theirs = placedColleague($tenant, 'theirs@verdant.test', (string) $quoz->getKey());
    $path = "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$theirs->membership->getKey()}";

    $this->actingAs($tenant->user)->getJson($path, AccessWorld::headers($tenant))->assertNotFound();

    $this->actingAs($tenant->user)
        ->putJson("{$path}/roles", ['roles' => [['role_id' => (string) $tenant->role->getKey()]]], AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertNotFound();

    expect(MembershipRole::withoutTenancy()->where('membership_id', $theirs->membership->getKey())->where('role_id', $tenant->role->getKey())->exists())
        ->toBeFalse();
});

it('offers and accepts only the administrator’s own branch as a scope', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [$hamra, $quoz] = AccessWorld::bindToBranch($tenant);
    $cook = placedColleague($tenant, 'cook@verdant.test', (string) $hamra->getKey());
    $path = "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}";

    $this->actingAs($tenant->user)
        ->getJson($path, AccessWorld::headers($tenant))
        ->assertOk()
        ->assertJsonPath('meta.branches', [['id' => (string) $hamra->getKey(), 'name' => 'Hamra']]);

    foreach ([null, (string) $quoz->getKey()] as $elsewhere) {
        $this->actingAs($tenant->user)
            ->patchJson($path, ['branch_id' => $elsewhere], AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
            ->assertUnprocessable();
    }

    expect((string) OrganisationMembership::withoutTenancy()->whereKey($cook->membership->getKey())->value('branch_id'))
        ->toBe((string) $hamra->getKey());
});

it('refuses a branch-bound administrator every change to a role definition', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    AccessWorld::bindToBranch($tenant);
    $role = AccessWorld::role($tenant->organisation, 'line_cook', []);
    $roles = "/api/v1/organisations/{$tenant->organisation->getKey()}/roles";
    $body = ['name_en' => 'Cook', 'name_ar' => 'طباخ', 'description_en' => null, 'description_ar' => null, 'permissions' => []];

    $this->actingAs($tenant->user)
        ->postJson($roles, $body + ['code' => 'night_cook'], AccessWorld::headers($tenant))
        ->assertForbidden();

    $this->actingAs($tenant->user)
        ->patchJson("{$roles}/{$role->getKey()}", $body, AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertForbidden();

    $this->actingAs($tenant->user)
        ->deleteJson("{$roles}/{$role->getKey()}", [], AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertForbidden();

    // Reading the role book is still theirs: they assign from it.
    $this->actingAs($tenant->user)->getJson($roles, AccessWorld::headers($tenant))->assertOk();
});

it('places a new account in the administrator’s branch and refuses any other', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [$hamra, $quoz] = AccessWorld::bindToBranch($tenant);
    session()->put('auth.password_confirmed_at', time());

    $body = [
        'email' => 'ahmad.khalil@verdant.test',
        'given_name' => 'Ahmad',
        'family_name' => 'Khalil',
        'password' => 'correct horse battery staple',
        'role_ids' => [],
    ];
    $staff = "/api/v1/organisations/{$tenant->organisation->getKey()}/staff";

    $this->actingAs($tenant->user)
        ->postJson($staff, $body + ['branch_id' => (string) $quoz->getKey()], AccessWorld::headers($tenant))
        ->assertUnprocessable();

    $this->actingAs($tenant->user)
        ->postJson($staff, $body + ['branch_id' => null], AccessWorld::headers($tenant))
        ->assertCreated()
        ->assertJsonPath('data.membership.branch.id', (string) $hamra->getKey());
});

it('invites into the administrator’s own branch by default', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [$hamra, $quoz] = AccessWorld::bindToBranch($tenant);
    $invitations = "/api/v1/organisations/{$tenant->organisation->getKey()}/invitations";

    $this->actingAs($tenant->user)
        ->postJson($invitations, ['email' => 'new@verdant.test', 'role_code' => 'administrator', 'branch_id' => (string) $quoz->getKey()], AccessWorld::headers($tenant))
        ->assertUnprocessable();

    $this->actingAs($tenant->user)
        ->postJson($invitations, ['email' => 'new@verdant.test', 'role_code' => 'administrator'], AccessWorld::headers($tenant))
        ->assertCreated();

    expect((string) OrganisationInvitation::query()->where('email_normalised', 'new@verdant.test')->sole()->branch_id)
        ->toBe((string) $hamra->getKey());
});

it('refuses to invite somebody who already works elsewhere in the kitchen', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [, $quoz] = AccessWorld::bindToBranch($tenant);
    placedColleague($tenant, 'owner@verdant.test', null);
    placedColleague($tenant, 'theirs@verdant.test', (string) $quoz->getKey());

    foreach (['owner@verdant.test', 'theirs@verdant.test'] as $email) {
        $this->actingAs($tenant->user)
            ->postJson(
                "/api/v1/organisations/{$tenant->organisation->getKey()}/invitations",
                ['email' => $email, 'role_code' => 'administrator'],
                AccessWorld::headers($tenant),
            )
            ->assertUnprocessable()
            ->assertJsonPath('error.details.fields.email.0', 'This person already belongs to this organisation outside your branch.');
    }

    expect(OrganisationInvitation::query()->whereIn('email_normalised', ['owner@verdant.test', 'theirs@verdant.test'])->exists())
        ->toBeFalse();
});

it('will not replace, list or withdraw another branch’s offer', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [, $quoz] = AccessWorld::bindToBranch($tenant);

    $theirs = OrganisationInvitation::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'branch_id' => $quoz->getKey(),
        'email' => 'wanted@verdant.test',
        'email_normalised' => 'wanted@verdant.test',
        'role_code' => 'administrator',
    ]);
    $invitations = "/api/v1/organisations/{$tenant->organisation->getKey()}/invitations";

    $this->actingAs($tenant->user)
        ->postJson($invitations, ['email' => 'wanted@verdant.test', 'role_code' => 'administrator'], AccessWorld::headers($tenant))
        ->assertConflict();

    $listed = collect($this->actingAs($tenant->user)
        ->getJson($invitations, AccessWorld::headers($tenant))
        ->assertOk()
        ->json('data'))->pluck('id')->all();

    expect($listed)->not->toContain((string) $theirs->getKey());

    $this->actingAs($tenant->user)
        ->deleteJson("{$invitations}/{$theirs->getKey()}", [], AccessWorld::headers($tenant))
        ->assertNotFound();

    expect($theirs->fresh()?->revoked_at)->toBeNull();
});

it('never moves an existing membership when a branch invitation is accepted', function (): void {
    $tenant = AccessWorld::kitchen('manager@verdant.test');
    [$hamra] = AccessWorld::bindToBranch($tenant);
    $owner = placedColleague($tenant, 'owner@verdant.test', null);

    $invitation = OrganisationInvitation::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'branch_id' => $hamra->getKey(),
        'email' => 'owner@verdant.test',
        'email_normalised' => 'owner@verdant.test',
        'role_code' => 'administrator',
        'invited_by' => $tenant->user->getKey(),
    ]);

    expect(app(MembershipGranter::class)->grant($invitation, $owner->user))->toBeNull()
        ->and(OrganisationMembership::withoutTenancy()->whereKey($owner->membership->getKey())->value('branch_id'))->toBeNull()
        ->and(MembershipRole::withoutTenancy()->where('membership_id', $owner->membership->getKey())->where('role_id', $tenant->role->getKey())->exists())->toBeFalse();
});

it('leaves a whole-kitchen administrator free to place people in any branch', function (): void {
    $tenant = AccessWorld::kitchen('owner@verdant.test');
    [$hamra, $quoz] = AccessWorld::bindToBranch($tenant);
    $tenant->membership->forceFill(['branch_id' => null])->save();
    $cook = placedColleague($tenant, 'cook@verdant.test', (string) $hamra->getKey());

    $this->actingAs($tenant->user)
        ->patchJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$cook->membership->getKey()}",
            ['branch_id' => (string) $quoz->getKey()],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch(0),
        )
        ->assertOk()
        ->assertJsonPath('data.membership.branch.id', (string) $quoz->getKey());
});
