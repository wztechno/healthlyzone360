<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\Role;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Consent\Models\ConsentGrant;
use Healthy360\Features\Models\FeatureEntitlement;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RecordTenantSettingsJob;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| Row-level security — the Phase 6 gate
|--------------------------------------------------------------------------
|
| These assertions are about the database, not the application. Every one of
| them runs raw SQL under `SET ROLE healthy360_test`, a role that owns nothing
| and holds NOBYPASSRLS, so the policies apply exactly as they will to
| healthy360_app in production. The fixtures are built beforehand as the
| schema owner, which is how migrations and seeders legitimately work.
|
| The application-layer equivalent — global scopes, policies, middleware — is
| proven separately in CrossOrganisationIsolationTest. Two independent layers,
| two independent suites (ADR-0007).
|
| The set grew from six tables to **eight** in K1.2: `recipe_versions` and
| `recipe_version_lines` join it, because a formulation leak is the worst
| failure this schema can have and an application scope is not a defence
| against a query somebody forgets to scope. The other four recipe tables are
| `join-rls-parent` — reachable only through a version, cascade-deleted with
| it, protected by the policy above them.
|
| K1.3 takes it to **nine**. `recipe_cost_snapshots` carries both an
| organisation policy and the `audit_logs` treatment — UPDATE and DELETE
| revoked at grant level — because it names two strategies: `org-rls` keeps one
| kitchen's margins away from another, and `append-only-ledger` keeps a kitchen
| from rewriting its own cost history. The policy alone would only have
| achieved the first.
|
*/

uses()->group('rls');

/**
 * @return array<string, int>
 */
function rlsVisibleCounts(): array
{
    $counts = [];

    $tables = [
        'organisation_branches', 'organisation_memberships', 'roles',
        'feature_entitlements', 'consent_grants', 'audit_logs',
        'recipe_versions', 'recipe_version_lines', 'recipe_cost_snapshots',
    ];

    foreach ($tables as $table) {
        /** @var object{total: int} $row */
        $row = DB::selectOne("select count(*) as total from {$table}");

        $counts[$table] = (int) $row->total;
    }

    return $counts;
}

/**
 * A complete tenant across all nine protected tables.
 */
function rlsTenant(ConsentDefinition $definition): object
{
    $organisation = Organisation::factory()->create();
    $user = User::factory()->create();

    $branch = OrganisationBranch::factory()->create(['organisation_id' => $organisation->getKey()]);

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

    $entitlement = FeatureEntitlement::factory()->create(['organisation_id' => $organisation->getKey()]);

    $consent = ConsentGrant::factory()->create([
        'user_id' => $user->getKey(),
        'consent_definition_id' => $definition->getKey(),
        'organisation_id' => null,
    ]);

    $audit = AuditLog::factory()->create([
        'actor_user_id' => $user->getKey(),
        'organisation_id' => $organisation->getKey(),
    ]);

    $recipe = Recipe::factory()->create(['organisation_id' => $organisation->getKey()]);

    $version = RecipeVersion::factory()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisation->getKey(),
    ]);

    $ingredient = Ingredient::factory()->create(['organisation_id' => $organisation->getKey()]);

    $line = RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $organisation->getKey(),
        'ingredient_id' => $ingredient->getKey(),
    ]);

    $snapshot = RecipeCostSnapshot::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $organisation->getKey(),
    ]);

    return (object) compact(
        'organisation', 'user', 'branch', 'membership', 'role', 'entitlement',
        'consent', 'audit', 'recipe', 'version', 'ingredient', 'line', 'snapshot',
    );
}

beforeEach(function (): void {
    app(TenantContext::class)->clear();

    $definition = ConsentDefinition::factory()->create();

    $this->a = rlsTenant($definition);
    $this->b = rlsTenant($definition);
});

afterEach(function (): void {
    RuntimeRole::context();
    RecordTenantSettingsJob::forget();
});

it('fails closed on every protected table when the session carries no context', function (): void {
    RuntimeRole::context();

    $counts = RuntimeRole::run(rlsVisibleCounts(...));

    expect($counts)->toBe([
        'organisation_branches' => 0,
        'organisation_memberships' => 0,
        'roles' => 0,
        'feature_entitlements' => 0,
        'consent_grants' => 0,
        'audit_logs' => 0,
        'recipe_versions' => 0,
        'recipe_version_lines' => 0,
        'recipe_cost_snapshots' => 0,
    ]);
});

it('fails closed just as hard when the context is set to an empty string', function (): void {
    // A reset connection carries empty strings rather than unset variables;
    // the two must be indistinguishable to the policies.
    DB::statement("select set_config('app.organisation_id', '', false), set_config('app.user_id', '', false)");

    $counts = RuntimeRole::run(rlsVisibleCounts(...));

    expect(array_sum($counts))->toBe(0);
});

it('shows one organisation its own rows and nothing of the other', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    [$branches, $memberships, $entitlements] = RuntimeRole::run(fn (): array => [
        DB::table('organisation_branches')->pluck('id')->all(),
        DB::table('organisation_memberships')->pluck('id')->all(),
        DB::table('feature_entitlements')->pluck('id')->all(),
    ]);

    expect($branches)->toBe([$this->b->branch->getKey()])
        ->and($memberships)->toBe([$this->b->membership->getKey()])
        ->and($entitlements)->toBe([$this->b->entitlement->getKey()])
        ->and($branches)->not->toContain($this->a->branch->getKey());
});

it('updates nothing when a statement targets another organisation rows', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    [$updated, $deleted] = RuntimeRole::run(fn (): array => [
        DB::table('organisation_branches')->where('id', $this->a->branch->getKey())->update(['city' => 'Rewritten']),
        DB::table('feature_entitlements')->where('id', $this->a->entitlement->getKey())->delete(),
    ]);

    expect($updated)->toBe(0)
        ->and($deleted)->toBe(0)
        ->and(OrganisationBranch::withoutTenancy()->whereKey($this->a->branch->getKey())->value('city'))
        ->not->toBe('Rewritten')
        ->and(FeatureEntitlement::withoutTenancy()->whereKey($this->a->entitlement->getKey())->exists())
        ->toBeTrue();
});

it('rejects an insert that would plant a row in another organisation', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    // A savepoint, so the WITH CHECK violation does not abort the transaction
    // the test itself is running inside.
    $insert = fn () => DB::transaction(fn () => DB::table('organisation_branches')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->a->organisation->getKey(),
        'name' => 'Smuggled',
        'country_code' => $this->a->branch->country_code,
        'timezone' => 'UTC',
        'status' => 'active',
        'lock_version' => 0,
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    RuntimeRole::run(function () use ($insert): void {
        expect($insert)->toThrow(QueryException::class);
    });

    expect(OrganisationBranch::withoutTenancy()->where('name', 'Smuggled')->exists())->toBeFalse();
});

it('shows a kitchen its own recipe versions and lines and nothing of the other', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    [$versions, $lines] = RuntimeRole::run(fn (): array => [
        DB::table('recipe_versions')->pluck('id')->all(),
        DB::table('recipe_version_lines')->pluck('id')->all(),
    ]);

    expect($versions)->toBe([$this->b->version->getKey()])
        ->and($lines)->toBe([$this->b->line->getKey()])
        ->and($versions)->not->toContain($this->a->version->getKey())
        ->and($lines)->not->toContain($this->a->line->getKey());
});

it('never lets one kitchen rewrite or erase another kitchens formulation', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    [$versionUpdated, $lineUpdated, $lineDeleted] = RuntimeRole::run(fn (): array => [
        DB::table('recipe_versions')->where('id', $this->a->version->getKey())->update(['status' => 'published']),
        DB::table('recipe_version_lines')->where('id', $this->a->line->getKey())->update(['quantity' => 9999]),
        DB::table('recipe_version_lines')->where('id', $this->a->line->getKey())->delete(),
    ]);

    expect($versionUpdated)->toBe(0)
        ->and($lineUpdated)->toBe(0)
        ->and($lineDeleted)->toBe(0)
        ->and(RecipeVersion::withoutTenancy()->whereKey($this->a->version->getKey())->value('status'))->not->toBe('published')
        ->and(RecipeVersionLine::withoutTenancy()->whereKey($this->a->line->getKey())->exists())->toBeTrue();
});

it('rejects an insert that would plant a recipe line in another kitchen', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    $insert = fn () => DB::transaction(fn () => DB::table('recipe_version_lines')->insert([
        'id' => (string) Str::uuid7(),
        'recipe_version_id' => $this->a->version->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'line_number' => 99,
        'ingredient_id' => $this->a->ingredient->getKey(),
        'quantity' => 1,
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    RuntimeRole::run(function () use ($insert): void {
        expect($insert)->toThrow(QueryException::class);
    });

    expect(RecipeVersionLine::withoutTenancy()->where('line_number', 99)->exists())->toBeFalse();
});

it('shows a kitchen its own cost snapshots and nothing of the other', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    $visible = RuntimeRole::run(fn (): array => DB::table('recipe_cost_snapshots')->pluck('id')->all());

    expect($visible)->toBe([$this->b->snapshot->getKey()])
        ->and($visible)->not->toContain($this->a->snapshot->getKey());
});

it('rejects a cost snapshot planted in another kitchen', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    $insert = fn () => DB::transaction(fn () => DB::table('recipe_cost_snapshots')->insert([
        'id' => (string) Str::uuid7(),
        'recipe_version_id' => $this->a->version->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
        'currency_code' => $this->a->organisation->default_currency_code,
        'basis' => 'recalculated',
        'total_input_cost_amount' => '99.999999',
        'waste_coefficient_percent' => '3.00',
        'calculated_at' => now(),
        'created_at' => now(),
    ]));

    RuntimeRole::run(function () use ($insert): void {
        expect($insert)->toThrow(QueryException::class);
    });

    expect(RecipeCostSnapshot::withoutTenancy()->where('total_input_cost_amount', '99.999999')->exists())->toBeFalse();
});

it('refuses to rewrite or erase a cost snapshot at grant level, even its own', function (): void {
    // The distinction that matters. The organisation policy already refuses
    // another kitchen's rows; what makes this an append-only ledger is that
    // the application role cannot rewrite the rows it *can* see. A cost
    // history that can be edited after the fact is not a history.
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    RuntimeRole::run(function (): void {
        $update = fn () => DB::transaction(fn () => DB::table('recipe_cost_snapshots')
            ->where('id', $this->b->snapshot->getKey())
            ->update(['total_input_cost_amount' => '0.000001']));

        $delete = fn () => DB::transaction(fn () => DB::table('recipe_cost_snapshots')
            ->where('id', $this->b->snapshot->getKey())
            ->delete());

        expect($update)->toThrow(QueryException::class, 'permission denied')
            ->and($delete)->toThrow(QueryException::class, 'permission denied');
    });

    expect(RecipeCostSnapshot::withoutTenancy()->whereKey($this->b->snapshot->getKey())->exists())->toBeTrue()
        ->and((string) RecipeCostSnapshot::withoutTenancy()->whereKey($this->b->snapshot->getKey())->value('total_input_cost_amount'))
        ->not->toBe('0.000001');
});

it('lets a kitchen append a cost snapshot inside its own organisation', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    $id = (string) Str::uuid7();

    $visible = RuntimeRole::run(function () use ($id): array {
        DB::table('recipe_cost_snapshots')->insert([
            'id' => $id,
            'recipe_version_id' => $this->b->version->getKey(),
            'organisation_id' => $this->b->organisation->getKey(),
            'currency_code' => $this->b->organisation->default_currency_code,
            'basis' => 'recalculated',
            'total_input_cost_amount' => '10.000000',
            'waste_coefficient_percent' => '3.00',
            'calculated_at' => now(),
            'created_at' => now(),
        ]);

        return DB::table('recipe_cost_snapshots')->pluck('id')->all();
    });

    expect($visible)->toContain($id)
        ->and($visible)->not->toContain($this->a->snapshot->getKey());
});

it('refuses to rewrite or erase an audit record at grant level', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    RuntimeRole::run(function (): void {
        $update = fn () => DB::transaction(fn () => DB::table('audit_logs')
            ->where('id', $this->b->audit->getKey())
            ->update(['action' => 'tampered']));

        $delete = fn () => DB::transaction(fn () => DB::table('audit_logs')
            ->where('id', $this->b->audit->getKey())
            ->delete());

        expect($update)->toThrow(QueryException::class, 'permission denied')
            ->and($delete)->toThrow(QueryException::class, 'permission denied');
    });

    expect(AuditLog::query()->whereKey($this->b->audit->getKey())->value('action'))->not->toBe('tampered');
});

it('lets the application append an audit record in any context but read only its own organisation', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    $id = (string) Str::uuid7();

    $visible = RuntimeRole::run(function () use ($id): array {
        DB::table('audit_logs')->insert([
            'id' => $id,
            'actor_user_id' => $this->b->user->getKey(),
            'organisation_id' => $this->b->organisation->getKey(),
            'action' => 'access.read',
            'subject_type' => 'organisation',
            'subject_id' => $this->b->organisation->getKey(),
            'purpose_of_use' => 'organisation_administration',
            'occurred_at' => now(),
            'created_at' => now(),
        ]);

        return DB::table('audit_logs')->pluck('id')->all();
    });

    expect($visible)->toContain($id)
        ->and($visible)->toContain($this->b->audit->getKey())
        ->and($visible)->not->toContain($this->a->audit->getKey());
});

it('keeps platform template roles readable in every context and other organisations roles invisible', function (): void {
    $template = Role::factory()->template()->create();

    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    $visible = RuntimeRole::run(fn (): array => DB::table('roles')->pluck('id')->all());

    expect($visible)->toEqualCanonicalizing([$template->getKey(), $this->b->role->getKey()])
        ->and($visible)->not->toContain($this->a->role->getKey());
});

it('never lets the application role write a platform template role', function (): void {
    $template = Role::factory()->template()->create();

    RuntimeRole::context((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    RuntimeRole::run(function () use ($template): void {
        $steal = fn () => DB::transaction(fn () => DB::table('roles')->insert([
            'id' => (string) Str::uuid7(),
            'organisation_id' => null,
            'code' => 'forged_template',
            'name_en' => 'Forged',
            'name_ar' => 'مزور',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]));

        expect($steal)->toThrow(QueryException::class)
            ->and(DB::table('roles')->where('id', $template->getKey())->update(['code' => 'hijacked']))->toBe(0);
    });

    expect(Role::withoutTenancy()->whereKey($template->getKey())->value('code'))->not->toBe('hijacked')
        ->and(Role::withoutTenancy()->where('code', 'forged_template')->exists())->toBeFalse();
});

it('shows a person their own consent grants from the user context alone', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey());

    $visible = RuntimeRole::run(fn (): array => DB::table('consent_grants')->pluck('id')->all());

    expect($visible)->toBe([$this->b->consent->getKey()])
        ->and($visible)->not->toContain($this->a->consent->getKey());
});

it('lets the data subject withdraw a consent but not another person', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey());

    $own = RuntimeRole::run(fn (): int => DB::table('consent_grants')
        ->where('id', $this->b->consent->getKey())
        ->update(['status' => 'withdrawn', 'withdrawn_at' => now()]));

    $other = RuntimeRole::run(fn (): int => DB::table('consent_grants')
        ->where('id', $this->a->consent->getKey())
        ->update(['status' => 'withdrawn', 'withdrawn_at' => now()]));

    expect($own)->toBe(1)
        ->and($other)->toBe(0)
        ->and(ConsentGrant::withoutTenancy()->whereKey($this->a->consent->getKey())->value('status')->value)
        ->toBe('granted');
});

it('erases no consent history: there is no delete policy at all', function (): void {
    RuntimeRole::context((string) $this->b->user->getKey());

    $deleted = RuntimeRole::run(fn (): int => DB::table('consent_grants')
        ->where('id', $this->b->consent->getKey())
        ->delete());

    expect($deleted)->toBe(0)
        ->and(ConsentGrant::withoutTenancy()->whereKey($this->b->consent->getKey())->exists())->toBeTrue();
});

it('gives each queued job its own tenant context on a shared connection and leaves none behind', function (): void {
    $tenant = app(TenantContext::class);

    RuntimeRole::run(function () use ($tenant): void {
        $tenant->setOrganisation((string) $this->a->user->getKey(), (string) $this->a->organisation->getKey());
        $tenant->setBranch((string) $this->a->branch->getKey());
        RecordTenantSettingsJob::dispatch('a');

        // Between the two jobs the connection must already be clean.
        expect(RuntimeRole::setting('app.organisation_id'))->toBe('');

        $tenant->setOrganisation((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());
        RecordTenantSettingsJob::dispatch('b');
    });

    expect(RecordTenantSettingsJob::$observed)->toBe([
        [
            'label' => 'a',
            'user_id' => (string) $this->a->user->getKey(),
            'organisation_id' => (string) $this->a->organisation->getKey(),
            'branch_id' => (string) $this->a->branch->getKey(),
            'visible_branches' => 1,
        ],
        [
            'label' => 'b',
            'user_id' => (string) $this->b->user->getKey(),
            'organisation_id' => (string) $this->b->organisation->getKey(),
            'branch_id' => '',
            'visible_branches' => 1,
        ],
    ]);

    expect(RuntimeRole::setting('app.user_id'))->toBe('')
        ->and(RuntimeRole::setting('app.organisation_id'))->toBe('')
        ->and(RuntimeRole::setting('app.branch_id'))->toBe('');
});

it('resets the session even when a queued job throws', function (): void {
    app(TenantContext::class)->setOrganisation((string) $this->a->user->getKey(), (string) $this->a->organisation->getKey());

    expect(RuntimeRole::setting('app.organisation_id'))->toBe((string) $this->a->organisation->getKey());

    try {
        dispatch(function (): void {
            throw new RuntimeException('job exploded');
        });
    } catch (Throwable) {
        // The sync queue rethrows; the reset must have happened regardless.
    }

    expect(RuntimeRole::setting('app.organisation_id'))->toBe('');
});

it('republishes the tenant context onto a reconnected connection', function (): void {
    $tenant = app(TenantContext::class);
    $tenant->setOrganisation((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());

    // A reconnected connection comes back with an empty session.
    DB::statement("select set_config('app.organisation_id', '', false), set_config('app.user_id', '', false)");
    expect(RuntimeRole::setting('app.organisation_id'))->toBe('');

    event(new ConnectionEstablished(DB::connection()));

    expect(RuntimeRole::setting('app.organisation_id'))->toBe((string) $this->b->organisation->getKey())
        ->and(RuntimeRole::setting('app.user_id'))->toBe((string) $this->b->user->getKey())
        ->and(app(DatabaseTenantContext::class)->applied())->toBe([
            'user_id' => (string) $this->b->user->getKey(),
            'organisation_id' => (string) $this->b->organisation->getKey(),
            'branch_id' => '',
        ]);
});

it('publishes every context change to the session, wherever it happens', function (): void {
    $tenant = app(TenantContext::class);

    $tenant->setUser((string) $this->b->user->getKey());
    expect(RuntimeRole::setting('app.user_id'))->toBe((string) $this->b->user->getKey())
        ->and(RuntimeRole::setting('app.organisation_id'))->toBe('');

    $tenant->setOrganisation((string) $this->b->user->getKey(), (string) $this->b->organisation->getKey());
    expect(RuntimeRole::setting('app.organisation_id'))->toBe((string) $this->b->organisation->getKey());

    $tenant->setBranch((string) $this->b->branch->getKey());
    expect(RuntimeRole::setting('app.branch_id'))->toBe((string) $this->b->branch->getKey());

    $tenant->clear();
    expect(RuntimeRole::setting('app.user_id'))->toBe('')
        ->and(RuntimeRole::setting('app.organisation_id'))->toBe('')
        ->and(RuntimeRole::setting('app.branch_id'))->toBe('');
});

it('protects exactly the nine declared tables and no others', function (): void {
    $protected = DB::table('pg_tables')
        ->where('schemaname', 'public')
        ->where('rowsecurity', true)
        ->orderBy('tablename')
        ->pluck('tablename')
        ->all();

    // Six from the foundation, two from K1.2, one from K1.3. Pinned so that a
    // new tenant-scoped table has to decide explicitly whether it joins the
    // set (ADR-0007 review trigger) rather than inheriting a policy by
    // accident — or, worse, quietly not having one.
    expect($protected)->toBe([
        'audit_logs',
        'consent_grants',
        'feature_entitlements',
        'organisation_branches',
        'organisation_memberships',
        'recipe_cost_snapshots',
        'recipe_version_lines',
        'recipe_versions',
        'roles',
    ]);
});

it('revokes write-back privileges on exactly the two append-only ledgers', function (): void {
    // The `append-only-ledger` strategy is a grant, not a policy, so nothing
    // in pg_policies would reveal its absence. Pinned for the same reason the
    // policy set is: a third ledger has to be a deliberate act, and a
    // migration that quietly granted UPDATE back would fail here.
    $writable = DB::table('information_schema.table_privileges')
        ->where('grantee', 'healthy360_app')
        ->whereIn('privilege_type', ['UPDATE', 'DELETE'])
        ->whereIn('table_name', ['audit_logs', 'recipe_cost_snapshots', 'recipe_versions', 'recipe_version_lines'])
        ->orderBy('table_name')
        ->pluck('table_name')
        ->unique()
        ->values()
        ->all();

    expect($writable)->toBe(['recipe_version_lines', 'recipe_versions']);
});

it('still migrates and seeds under the owner role with row-level security enabled', function (): void {
    // RefreshDatabase already migrated as the schema owner; seeding on top of
    // enabled policies is the other half of the claim, and it writes to five
    // of the six protected tables with no session context whatsoever.
    $this->seed();

    // Eight platform template roles since K1.1: the four foundation roles plus
    // kitchen_manager, kitchen_chef, kitchen_staff and commercial_manager.
    // Pinned so a new template role has to be a deliberate act. K1.3 widened
    // three of them with `recipe.view_costs_organisation` and added none.
    expect(Role::withoutTenancy()->whereNull('organisation_id')->count())->toBe(8)
        ->and(OrganisationBranch::withoutTenancy()->count())->toBeGreaterThan(2)
        ->and(OrganisationMembership::withoutTenancy()->count())->toBeGreaterThan(2)
        ->and(ConsentDefinition::query()->count())->toBeGreaterThan(1);
});
