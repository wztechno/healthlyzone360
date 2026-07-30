<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Features\Models\FeatureEntitlement;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Exceptions\MissingTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/*
|--------------------------------------------------------------------------
| Cross-organisation isolation — the Phase 3 gate
|--------------------------------------------------------------------------
|
| Two fully-populated organisations exist at all times in this file. With the
| tenant context set to B, nothing belonging to A may be readable, writable
| or authorisable, and with no context at all every scoped path must fail
| closed (plan §11 Phase 1A).
|
*/

/**
 * The foundation permissions these tests authorise against; each tenant's
 * role is granted all of them, so a denial can only come from isolation.
 *
 * @var list<string>
 */
const ISOLATION_PERMISSION_CODES = [
    'organisation.view_current',
    'branch.view_current',
    'membership.view_organisation',
    'role.view_organisation',
];

/**
 * A complete tenant: organisation, branch, user, active membership, a role
 * granting every ISOLATION_PERMISSION_CODES permission, and an entitlement.
 *
 * @param  Collection<string, Permission>  $permissions
 */
function isolationTenant(Collection $permissions): object
{
    $organisation = Organisation::factory()->create();

    $branch = OrganisationBranch::factory()->create([
        'organisation_id' => $organisation->getKey(),
    ]);

    $user = User::factory()->create();

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create([
        'organisation_id' => $organisation->getKey(),
    ]);

    foreach ($permissions as $permission) {
        RolePermission::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'role_id' => $role->getKey(),
            'permission_id' => $permission->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    $entitlement = FeatureEntitlement::factory()->create([
        'organisation_id' => $organisation->getKey(),
    ]);

    return (object) compact('organisation', 'branch', 'user', 'membership', 'role', 'entitlement');
}

beforeEach(function (): void {
    app(TenantContext::class)->clear();

    $permissions = collect(ISOLATION_PERMISSION_CODES)->mapWithKeys(
        fn (string $code): array => [$code => Permission::factory()->create([
            'code' => $code,
            'domain' => explode('.', $code)[0],
        ])],
    );

    $this->tenantA = isolationTenant($permissions);
    $this->tenantB = isolationTenant($permissions);
});

function enterTenantB(): void
{
    /** @var object{organisation: Organisation, user: User} $tenant */
    $tenant = test()->tenantB;

    app(TenantContext::class)->setOrganisation(
        (string) $tenant->user->getKey(),
        (string) $tenant->organisation->getKey(),
    );
}

it('returns only the active organisation rows from scoped queries', function (): void {
    enterTenantB();

    expect(OrganisationBranch::query()->pluck('id')->all())
        ->toBe([$this->tenantB->branch->getKey()])
        ->and(OrganisationMembership::query()->pluck('id')->all())
        ->toBe([$this->tenantB->membership->getKey()])
        ->and(Role::query()->pluck('id')->all())
        ->toBe([$this->tenantB->role->getKey()])
        ->and(FeatureEntitlement::query()->pluck('id')->all())
        ->toBe([$this->tenantB->entitlement->getKey()]);
});

it('hides another organisation row even when it is addressed by key', function (): void {
    enterTenantB();

    expect(OrganisationBranch::query()->find($this->tenantA->branch->getKey()))->toBeNull()
        ->and(OrganisationMembership::query()->find($this->tenantA->membership->getKey()))->toBeNull()
        ->and(Role::query()->find($this->tenantA->role->getKey()))->toBeNull();
});

it('cannot update or delete another organisation rows through a scoped query', function (): void {
    enterTenantB();

    $affected = OrganisationBranch::query()
        ->whereKey($this->tenantA->branch->getKey())
        ->update(['city' => 'Rewritten']);

    $deleted = OrganisationBranch::query()
        ->whereKey($this->tenantA->branch->getKey())
        ->delete();

    expect($affected)->toBe(0)
        ->and($deleted)->toBe(0)
        ->and(OrganisationBranch::withoutTenancy()->whereKey($this->tenantA->branch->getKey())->exists())->toBeTrue();
});

it('keeps platform template roles visible inside every tenant context', function (): void {
    $template = Role::factory()->template()->create();

    enterTenantB();

    expect(Role::query()->pluck('id')->all())
        ->toEqualCanonicalizing([$this->tenantB->role->getKey(), $template->getKey()]);
});

it('denies policy access to another organisation models', function (): void {
    enterTenantB();

    $gate = Gate::forUser($this->tenantB->user);

    expect($gate->allows('view', $this->tenantB->organisation))->toBeTrue()
        ->and($gate->allows('view', $this->tenantB->branch))->toBeTrue()
        ->and($gate->allows('view', $this->tenantB->membership))->toBeTrue()
        ->and($gate->allows('view', $this->tenantB->role))->toBeTrue()
        ->and($gate->allows('view', $this->tenantA->organisation))->toBeFalse()
        ->and($gate->allows('view', $this->tenantA->branch))->toBeFalse()
        ->and($gate->allows('view', $this->tenantA->membership))->toBeFalse()
        ->and($gate->allows('view', $this->tenantA->role))->toBeFalse();
});

it('denies another organisation user access to this organisation models', function (): void {
    enterTenantB();

    expect(Gate::forUser($this->tenantA->user)->allows('view', $this->tenantB->branch))->toBeFalse();
});

it('fails closed when an organisation-scoped model is read without a tenant context', function (): void {
    OrganisationBranch::query()->get();
})->throws(MissingTenantContext::class);

it('fails closed when an organisation-scoped model is created without a tenant context', function (): void {
    OrganisationBranch::factory()->create(['organisation_id' => null]);
})->throws(MissingTenantContext::class);

it('allows platform-global rows to be created without a tenant context', function (): void {
    $template = Role::factory()->template()->create();

    expect($template->organisation_id)->toBeNull()
        ->and($template->is_system)->toBeTrue();
});

it('fills the scoping column from the active context on create', function (): void {
    enterTenantB();

    $branch = new OrganisationBranch([
        'name' => 'Context filled',
        'country_code' => $this->tenantB->branch->country_code,
        'timezone' => 'UTC',
    ]);
    $branch->save();

    expect($branch->organisation_id)->toBe($this->tenantB->organisation->getKey());
});
