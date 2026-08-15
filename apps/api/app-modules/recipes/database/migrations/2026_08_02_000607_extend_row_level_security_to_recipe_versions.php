<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The K1.2 extension of the row-level-security set (master plan v2 §4.12,
 * ADR-0007): `recipe_versions` and `recipe_version_lines` join the six
 * foundation tables, taking the pinned set to **eight**.
 *
 * Why these two and not all six new tables. A formulation is the most
 * commercially sensitive thing this schema holds — the lines *are* the
 * competitor's shopping list — so the strategy for both is `org-rls`, a real
 * PostgreSQL policy rather than an application scope. The outputs, steps and
 * frozen allergen rows are `join-rls-parent`: they are reachable only through
 * a version, cascade-delete with it, and are protected by the policy on the
 * table above them. Adding four more policies would buy no isolation the
 * parent does not already provide, and every policy is a predicate evaluated
 * on every row of every query.
 *
 * The migration lives in the recipes module and runs after the recipes tables
 * exist — a policy cannot be created on a table that does not exist yet, and
 * the tenancy module must not learn about recipes. It copies the tenancy
 * migration's structure deliberately: drop-then-create so a partially applied
 * run is re-runnable, `roles()` guarding the case where the runtime roles were
 * never provisioned, and `ALL` policies carrying both `USING` and
 * `WITH CHECK` so a read, a write and a delete are all confined to the active
 * organisation.
 *
 * `current_setting(..., true)` means an unset variable yields NULL, every
 * predicate evaluates false, and a connection with no tenant context reads
 * nothing and writes nothing. RLS is enabled but not forced: the migrator role
 * owns these tables, so migrations, seeders and the importer keep working.
 */
return new class extends Migration
{
    /**
     * The tables this migration protects, in the order the policies are
     * declared below.
     *
     * @var list<string>
     */
    private const array TABLES = [
        'recipe_versions',
        'recipe_version_lines',
    ];

    /**
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    private const string POLICY = 'rls_organisation_scope';

    public function up(): void
    {
        $this->dropPolicies();

        foreach (self::TABLES as $table) {
            DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
        }

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        // Plain organisation ownership. There is no platform-library case to
        // allow through: unlike `ingredients`, a recipe always belongs to
        // exactly one organisation, so a NULL organisation on either table is
        // simply impossible (both columns are NOT NULL) and a policy branch
        // for it would be dead code that reads like an intention.
        foreach (self::TABLES as $table) {
            DB::statement(
                'CREATE POLICY '.self::POLICY." ON {$table} FOR ALL TO {$roles}
                 USING (".self::ORGANISATION_MATCH.')
                 WITH CHECK ('.self::ORGANISATION_MATCH.')'
            );
        }
    }

    public function down(): void
    {
        $this->dropPolicies();

        foreach (self::TABLES as $table) {
            DB::statement("ALTER TABLE {$table} DISABLE ROW LEVEL SECURITY");
        }
    }

    private function dropPolicies(): void
    {
        foreach (self::TABLES as $table) {
            DB::statement('DROP POLICY IF EXISTS '.self::POLICY." ON {$table}");
        }
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list.
     *
     * A database provisioned without infrastructure/docker/postgres/init has
     * neither role. Enabling RLS with no policies at all is still the correct
     * fail-closed outcome there — every non-owner reads nothing — so the
     * migration completes rather than aborting a schema build.
     */
    private function roles(): ?string
    {
        /** @var list<string> $existing */
        $existing = DB::connection()
            ->table('pg_roles')
            ->whereIn('rolname', self::RUNTIME_ROLES)
            ->orderBy('rolname')
            ->pluck('rolname')
            ->all();

        if ($existing === []) {
            return null;
        }

        return implode(', ', array_map(static fn (string $role): string => '"'.$role.'"', $existing));
    }
};
