<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The six-step RBAC decision (plan §10)
|--------------------------------------------------------------------------
|
| Every AccessDenialReason must be reachable and must be reached for exactly
| the step it names. Allow-only: there are no deny rules, so an allow is
| always the union of the currently effective role grants.
|
*/

beforeEach(function (): void {
    app(TenantContext::class)->clear();

    $this->organisation = Organisation::factory()->create();
    $this->branch = OrganisationBranch::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    $this->user = User::factory()->create();
    $this->membership = OrganisationMembership::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'user_id' => $this->user->getKey(),
    ]);
    $this->permission = Permission::factory()->create([
        'code' => 'organisation.view_current',
        'domain' => 'organisation',
    ]);
    $this->checker = app(PermissionChecker::class);
});

/**
 * The tenant context for the fixture organisation, optionally with a branch.
 */
function checkerContext(?string $branchId = null): TenantContext
{
    /** @var object{organisation: Organisation, user: User} $fixture */
    $fixture = test();

    $context = app(TenantContext::class);
    $context->setOrganisation(
        (string) $fixture->user->getKey(),
        (string) $fixture->organisation->getKey(),
    );

    if ($branchId !== null) {
        $context->setBranch($branchId);
    }

    return $context;
}

/**
 * Grant the fixture permission through a role assigned to the membership.
 */
function grantFixturePermission(?Role $role = null): Role
{
    $organisationId = test()->organisation->getKey();

    $role ??= Role::factory()->create(['organisation_id' => $organisationId]);

    RolePermission::factory()->create([
        'organisation_id' => $role->organisation_id,
        'role_id' => $role->getKey(),
        'permission_id' => test()->permission->getKey(),
    ]);

    MembershipRole::factory()->create([
        'organisation_id' => $organisationId,
        'membership_id' => test()->membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return $role;
}

it('denies an unauthenticated caller', function (): void {
    $decision = $this->checker->check(null, 'organisation.view_current', null, checkerContext());

    expect($decision->allowed)->toBeFalse()
        ->and($decision->denialReason)->toBe(AccessDenialReason::Unauthenticated);
});

it('denies a user with no membership in the selected organisation', function (): void {
    $decision = $this->checker->check(
        User::factory()->create(),
        'organisation.view_current',
        null,
        checkerContext(),
    );

    expect($decision->denialReason)->toBe(AccessDenialReason::MembershipInactive);
});

it('denies a membership that is not active', function (string $state): void {
    grantFixturePermission();
    $this->membership->forceFill(['status' => $state])->save();

    $decision = $this->checker->check($this->user, 'organisation.view_current', null, checkerContext());

    expect($decision->denialReason)->toBe(AccessDenialReason::MembershipInactive);
})->with(['invited', 'suspended', 'ended']);

it('denies a branch-scoped membership acting outside its branch', function (): void {
    grantFixturePermission();
    $this->membership->forceFill(['branch_id' => $this->branch->getKey()])->save();

    $elsewhere = OrganisationBranch::factory()->create(['organisation_id' => $this->organisation->getKey()]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::BranchOutOfScope)
        ->and($this->checker->check($this->user, 'organisation.view_current', null, checkerContext($elsewhere->getKey()))->denialReason)
        ->toBe(AccessDenialReason::BranchOutOfScope);
});

it('allows a branch-scoped membership inside its own branch', function (): void {
    grantFixturePermission();
    $this->membership->forceFill(['branch_id' => $this->branch->getKey()])->save();

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext($this->branch->getKey()))->allowed)
        ->toBeTrue();
});

it('denies a permission no assigned role grants', function (): void {
    grantFixturePermission();

    $decision = $this->checker->check($this->user, 'organisation.update_current', null, checkerContext());

    expect($decision->denialReason)->toBe(AccessDenialReason::PermissionNotGranted);
});

it('denies a resource belonging to another organisation', function (): void {
    grantFixturePermission();

    $foreign = OrganisationBranch::factory()->create([
        'organisation_id' => Organisation::factory()->create()->getKey(),
    ]);

    $decision = $this->checker->check($this->user, 'organisation.view_current', $foreign, checkerContext());

    expect($decision->denialReason)->toBe(AccessDenialReason::ResourceOutsideOrganisation);
});

it('denies an action a policy prohibits outright', function (): void {
    $managePermission = Permission::factory()->create([
        'code' => 'role.manage_organisation',
        'domain' => 'role',
    ]);

    $role = Role::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    RolePermission::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'role_id' => $role->getKey(),
        'permission_id' => $managePermission->getKey(),
    ]);
    MembershipRole::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'membership_id' => $this->membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    // RolePolicy forbids editing platform-defined system roles whatever the
    // granted permissions say.
    $systemRole = Role::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'is_system' => true,
    ]);

    $decision = $this->checker->check($this->user, 'role.manage_organisation', $systemRole, checkerContext());

    expect($decision->denialReason)->toBe(AccessDenialReason::PolicyDenied);
});

it('allows an action granted by an assigned role', function (): void {
    grantFixturePermission();

    $decision = $this->checker->check($this->user, 'organisation.view_current', $this->organisation, checkerContext());

    expect($decision->allowed)->toBeTrue()
        ->and($decision->denialReason)->toBeNull();
});

it('allows an action granted by an assigned platform template role', function (): void {
    grantFixturePermission(Role::factory()->template()->create());

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->allowed)
        ->toBeTrue();
});

it('ignores a role assignment that has not started yet', function (): void {
    $role = Role::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    RolePermission::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'role_id' => $role->getKey(),
        'permission_id' => $this->permission->getKey(),
    ]);
    MembershipRole::factory()->notStarted()->create([
        'organisation_id' => $this->organisation->getKey(),
        'membership_id' => $this->membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);
});

it('ignores a role assignment that has expired', function (): void {
    $role = Role::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    RolePermission::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'role_id' => $role->getKey(),
        'permission_id' => $this->permission->getKey(),
    ]);
    MembershipRole::factory()->expired()->create([
        'organisation_id' => $this->organisation->getKey(),
        'membership_id' => $this->membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);
});

it('ignores a permission that is not assignable', function (): void {
    $this->permission->forceFill(['is_assignable' => false])->save();
    grantFixturePermission();

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);
});

it('serves calculated permissions from cache until the version counter is bumped', function (): void {
    $role = Role::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    MembershipRole::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'membership_id' => $this->membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);

    // Insert the grant behind Eloquent's back so no observer fires: the
    // cached calculation must still be served.
    RolePermission::query()->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->organisation->getKey(),
        'role_id' => $role->getKey(),
        'permission_id' => $this->permission->getKey(),
        'created_at' => now(),
    ]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);

    app(PermissionCache::class)->bumpVersion((string) $this->organisation->getKey());

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->allowed)
        ->toBeTrue();
});

it('invalidates the cache automatically when a role permission is written', function (): void {
    $role = Role::factory()->create(['organisation_id' => $this->organisation->getKey()]);
    MembershipRole::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'membership_id' => $this->membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);

    $grant = RolePermission::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'role_id' => $role->getKey(),
        'permission_id' => $this->permission->getKey(),
    ]);

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->allowed)
        ->toBeTrue();

    $grant->delete();

    expect($this->checker->check($this->user, 'organisation.view_current', null, checkerContext())->denialReason)
        ->toBe(AccessDenialReason::PermissionNotGranted);
});

it('reaches every access denial reason', function (): void {
    // Guards the enum against a case that no test exercises: each reason
    // asserted above is listed here, so adding a case fails this test.
    expect(array_map(
        fn (AccessDenialReason $reason): string => $reason->value,
        AccessDenialReason::cases(),
    ))->toEqualCanonicalizing([
        'unauthenticated',
        'membership_inactive',
        'branch_out_of_scope',
        'permission_not_granted',
        'resource_outside_organisation',
        'policy_denied',
    ]);
});
