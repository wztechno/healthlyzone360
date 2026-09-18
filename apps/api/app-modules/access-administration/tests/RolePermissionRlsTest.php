<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| role_permissions under row-level security
|--------------------------------------------------------------------------
|
| Two halves, and the second is the one that would otherwise ship broken.
|
| The first proves the policy: under `SET ROLE healthy360_test` — a role that
| owns nothing and holds NOBYPASSRLS, so the policies bite exactly as they will
| in production — another kitchen's grants are invisible, a platform template's
| are not, and a write naming somebody else's organisation is refused.
|
| The second proves that adding the policy did not quietly narrow anybody's
| permissions. `PermissionChecker` reads this table through `withoutTenancy()`,
| which drops the Eloquent global scope and leaves the *database* policy fully
| in force — so if `app.organisation_id` were ever unset on a path that computes
| permissions, a tenant's own grants would vanish and the person would simply be
| able to do less, with no error anywhere. That failure has no symptom but a
| shrinking permission set, which is exactly why it is asserted rather than
| reasoned about: the same call, under the owner and under the runtime role,
| must return the same codes.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);

    app(TenantContext::class)->clear();
});

afterEach(function (): void {
    RuntimeRole::context();
});

it('hides another kitchen’s grants from the runtime role', function (): void {
    $mine = AccessWorld::kitchen('admin@verdant.test');
    $theirs = AccessWorld::kitchen('admin@cedar.test');

    $ours = AccessWorld::role($mine->organisation, 'evening_counter', ['order.view_organisation']);
    $stranger = AccessWorld::role($theirs->organisation, 'their_role', ['order.view_organisation']);

    RuntimeRole::context(
        (string) $mine->user->getKey(),
        (string) $mine->organisation->getKey(),
    );

    /** @var list<string> $visible */
    $visible = RuntimeRole::run(fn (): array => DB::table('role_permissions')
        ->pluck('role_id')
        ->map(static fn (mixed $id): string => (string) $id)
        ->all());

    expect($visible)->toContain((string) $ours->getKey())
        ->and($visible)->not->toContain((string) $stranger->getKey());
});

it('keeps a platform template’s grants readable in every tenant context', function (): void {
    // Without this the checker could not resolve a template role at all, and
    // every membership assigned one would come back with no permissions.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');

    RuntimeRole::context(
        (string) $tenant->user->getKey(),
        (string) $tenant->organisation->getKey(),
    );

    $visible = RuntimeRole::run(fn (): int => DB::table('role_permissions')
        ->where('role_id', $template->getKey())
        ->count());

    expect($visible)->toBeGreaterThan(0);
});

it('fails closed when the session carries no organisation at all', function (): void {
    AccessWorld::kitchen('admin@verdant.test');

    RuntimeRole::context();

    $visible = RuntimeRole::run(fn (): int => DB::table('role_permissions')
        ->whereNotNull('organisation_id')
        ->count());

    expect($visible)->toBe(0);
});

it('refuses a grant written into somebody else’s organisation', function (): void {
    $mine = AccessWorld::kitchen('admin@verdant.test');
    $theirs = AccessWorld::kitchen('admin@cedar.test');

    $stranger = AccessWorld::role($theirs->organisation, 'their_role', []);
    $permission = Permission::query()->where('code', 'order.view_organisation')->sole();

    RuntimeRole::context(
        (string) $mine->user->getKey(),
        (string) $mine->organisation->getKey(),
    );

    // A savepoint, so the WITH CHECK violation does not abort the transaction
    // the test itself is running inside.
    $insert = fn () => DB::transaction(fn () => DB::table('role_permissions')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => (string) $theirs->organisation->getKey(),
        'role_id' => (string) $stranger->getKey(),
        'permission_id' => (string) $permission->getKey(),
        'created_at' => now(),
    ]));

    RuntimeRole::run(function () use ($insert): void {
        expect($insert)->toThrow(QueryException::class);
    });

    expect(RolePermission::withoutTenancy()->where('role_id', $stranger->getKey())->count())->toBe(0);
});

it('refuses a grant written with no organisation, which is how a template would be forged', function (): void {
    // `NULL` never satisfies the write predicate, so a tenant physically cannot
    // add a permission to a platform template however the application is asked.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $template = AccessWorld::template('kitchen_manager');
    $permission = Permission::query()->where('code', 'organisation.update_current')->sole();

    RuntimeRole::context(
        (string) $tenant->user->getKey(),
        (string) $tenant->organisation->getKey(),
    );

    $before = RolePermission::withoutTenancy()->where('role_id', $template->getKey())->count();

    $insert = fn () => DB::transaction(fn () => DB::table('role_permissions')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => null,
        'role_id' => (string) $template->getKey(),
        'permission_id' => (string) $permission->getKey(),
        'created_at' => now(),
    ]));

    RuntimeRole::run(function () use ($insert): void {
        expect($insert)->toThrow(QueryException::class);
    });

    expect(RolePermission::withoutTenancy()->where('role_id', $template->getKey())->count())
        ->toBe($before);
});

it('lets a kitchen write its own grants, which is what the console does all day', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'evening_counter', []);
    $permission = Permission::query()->where('code', 'order.view_organisation')->sole();

    RuntimeRole::context(
        (string) $tenant->user->getKey(),
        (string) $tenant->organisation->getKey(),
    );

    RuntimeRole::run(fn () => DB::transaction(fn () => DB::table('role_permissions')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => (string) $tenant->organisation->getKey(),
        'role_id' => (string) $role->getKey(),
        'permission_id' => (string) $permission->getKey(),
        'created_at' => now(),
    ])));

    expect(RolePermission::withoutTenancy()->where('role_id', $role->getKey())->count())->toBe(1);
});

it('computes the same permissions under the runtime role as under the owner', function (): void {
    // **The regression this file exists for.** A policy that hid a tenant's own
    // grants from the checker would not raise anything — it would just return
    // fewer codes, and the person would find they could do less than yesterday.
    // Both a bespoke role and a platform template, because the two sit on
    // opposite sides of the SELECT predicate's `organisation_id IS NULL OR`.
    $tenant = AccessWorld::kitchen('admin@verdant.test', ['order.view_organisation']);

    AccessWorld::assign($tenant, AccessWorld::template('kitchen_manager'));

    $context = app(TenantContext::class);
    $context->setOrganisation(
        (string) $tenant->user->getKey(),
        (string) $tenant->organisation->getKey(),
    );

    $checker = app(PermissionChecker::class);
    $cache = app(PermissionCache::class);

    $asOwner = $checker->calculatedPermissions($tenant->user, $tenant->membership, $context);

    // The cache is keyed on a version counter, so without the bump the second
    // call would answer from the first and prove nothing at all.
    $cache->bumpVersion((string) $tenant->organisation->getKey());

    RuntimeRole::context(
        (string) $tenant->user->getKey(),
        (string) $tenant->organisation->getKey(),
    );

    $asRuntimeRole = RuntimeRole::run(
        fn (): array => $checker->calculatedPermissions($tenant->user, $tenant->membership, $context),
    );

    expect($asOwner)->not->toBeEmpty()
        ->and($asRuntimeRole)->toEqualCanonicalizing($asOwner)
        ->and($asRuntimeRole)->toContain('order.view_organisation');
});
