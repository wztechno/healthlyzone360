<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Every change to somebody's access leaves an audit row
|--------------------------------------------------------------------------
|
| One row per act, naming who did it and to which membership or role, with
| ids, role codes and the scope in the metadata — never a name, an address or
| a password.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

function membershipAuditRow(string $action): AuditLog
{
    return AuditLog::query()->where('action', $action)->sole();
}

function membershipAuditPath(object $tenant, object $member, string $suffix = ''): string
{
    return "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$member->membership->getKey()}{$suffix}";
}

it('records a scope change with the branch it moved from and to', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test');
    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $tenant->organisation->getKey(),
        'country_code' => $tenant->organisation->country_code,
    ]);

    $this->actingAs($tenant->user)
        ->patchJson(membershipAuditPath($tenant, $cook), ['branch_id' => (string) $branch->getKey()], AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertOk();

    $row = membershipAuditRow('membership.scope_changed');

    expect((string) $row->actor_user_id)->toBe((string) $tenant->user->getKey())
        ->and($row->subject_type)->toBe('organisation_membership')
        ->and((string) $row->subject_id)->toBe((string) $cook->membership->getKey())
        ->and((string) $row->organisation_id)->toBe((string) $tenant->organisation->getKey())
        ->and($row->metadata)->toEqual([
            'member_user_id' => (string) $cook->user->getKey(),
            'from_branch_id' => null,
            'to_branch_id' => (string) $branch->getKey(),
        ]);
});

it('records a suspension, a reactivation and an ending, each with its status move', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test');

    foreach (['/suspend' => 0, '/reactivate' => 1, '/end' => 2] as $suffix => $version) {
        $this->actingAs($tenant->user)
            ->postJson(membershipAuditPath($tenant, $cook, $suffix), [], AccessWorld::headers($tenant) + AccessWorld::ifMatch($version))
            ->assertOk();
    }

    $expected = [
        'membership.suspended' => [MembershipStatus::Active, MembershipStatus::Suspended],
        'membership.reactivated' => [MembershipStatus::Suspended, MembershipStatus::Active],
        'membership.ended' => [MembershipStatus::Active, MembershipStatus::Ended],
    ];

    foreach ($expected as $action => [$from, $to]) {
        $row = membershipAuditRow($action);

        expect((string) $row->actor_user_id)->toBe((string) $tenant->user->getKey())
            ->and($row->subject_type)->toBe('organisation_membership')
            ->and((string) $row->subject_id)->toBe((string) $cook->membership->getKey())
            ->and($row->metadata)->toEqual([
                'member_user_id' => (string) $cook->user->getKey(),
                'from_status' => $from->value,
                'to_status' => $to->value,
            ]);
    }
});

it('records a role replacement with the role codes before and after', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $cook = AccessWorld::colleague($tenant, 'cook@verdant.test', ['recipe.view_organisation'], 'line_cook');
    $desk = AccessWorld::role($tenant->organisation, 'desk', ['order.view_organisation']);

    $this->actingAs($tenant->user)
        ->putJson(
            membershipAuditPath($tenant, $cook, '/roles'),
            ['roles' => [['role_id' => (string) $desk->getKey()]]],
            AccessWorld::headers($tenant) + AccessWorld::ifMatch((int) $cook->membership->lock_version),
        )
        ->assertOk();

    $row = membershipAuditRow('membership.roles_replaced');

    expect((string) $row->actor_user_id)->toBe((string) $tenant->user->getKey())
        ->and($row->subject_type)->toBe('organisation_membership')
        ->and((string) $row->subject_id)->toBe((string) $cook->membership->getKey())
        // Not redacted: no key holds `code`, which the recorder blanks.
        ->and($row->metadata)->toEqual([
            'member_user_id' => (string) $cook->user->getKey(),
            'previous_roles' => ['line_cook'],
            'roles' => ['desk'],
        ]);
});

it('records a role created, updated and deleted', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $roles = "/api/v1/organisations/{$tenant->organisation->getKey()}/roles";
    $body = ['name_en' => 'Cook', 'name_ar' => 'طباخ', 'description_en' => null, 'description_ar' => null];

    $id = $this->actingAs($tenant->user)
        ->postJson($roles, $body + ['code' => 'night_cook', 'permissions' => ['recipe.view_organisation']], AccessWorld::headers($tenant))
        ->assertCreated()
        ->json('data.role.id');

    $this->actingAs($tenant->user)
        ->patchJson("{$roles}/{$id}", $body + ['permissions' => []], AccessWorld::headers($tenant) + AccessWorld::ifMatch(0))
        ->assertOk();

    $this->actingAs($tenant->user)
        ->deleteJson("{$roles}/{$id}", [], AccessWorld::headers($tenant) + AccessWorld::ifMatch(1))
        ->assertNoContent();

    $expected = [
        'role.created' => ['role' => 'night_cook', 'permissions' => ['recipe.view_organisation']],
        'role.updated' => ['role' => 'night_cook', 'permissions' => []],
        'role.deleted' => ['role' => 'night_cook'],
    ];

    foreach ($expected as $action => $metadata) {
        $row = membershipAuditRow($action);

        expect((string) $row->actor_user_id)->toBe((string) $tenant->user->getKey())
            ->and($row->subject_type)->toBe('role')
            ->and((string) $row->subject_id)->toBe((string) $id)
            ->and($row->metadata)->toEqual($metadata);
    }
});

it('records a provisioned staff account by id, never by address or password', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', ['recipe.view_organisation']);
    session()->put('auth.password_confirmed_at', time());

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/staff",
            [
                'email' => 'ahmad.khalil@verdant.test',
                'given_name' => 'Ahmad',
                'family_name' => 'Khalil',
                'password' => 'correct horse battery staple',
                'role_ids' => [(string) $role->getKey()],
                'branch_id' => null,
            ],
            AccessWorld::headers($tenant),
        )
        ->assertCreated();

    $membership = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $tenant->organisation->getKey())
        ->whereKeyNot($tenant->membership->getKey())
        ->sole();

    $row = membershipAuditRow('staff.provisioned');

    expect((string) $row->actor_user_id)->toBe((string) $tenant->user->getKey())
        ->and($row->subject_type)->toBe('organisation_membership')
        ->and((string) $row->subject_id)->toBe((string) $membership->getKey())
        ->and($row->metadata)->toEqual([
            'member_user_id' => (string) $membership->user_id,
            'branch_id' => null,
            'roles' => ['line_cook'],
        ])
        ->and(json_encode($row->metadata))->not->toContain('ahmad')
        ->and(json_encode($row->metadata))->not->toContain('horse');
});
