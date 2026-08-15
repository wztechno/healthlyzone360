<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The K1.3 extension of the row-level-security set (master plan v2 §4.12,
 * ADR-0007): `recipe_cost_snapshots` joins the eight tables K1.2 left behind,
 * taking the pinned set to **nine**.
 *
 * Two mechanisms, not one, because the table names two strategies.
 *
 * `org-rls` is the policy below: reads and inserts confined to the active
 * organisation, `current_setting(..., true)` so a connection with no tenant
 * context matches nothing and a session that was reset to empty strings
 * matches nothing either. A margin is a competitor's negotiating position; a
 * query somebody forgets to scope must not be able to serve one.
 *
 * `append-only-ledger` is the `REVOKE` at the end, copied deliberately from
 * the treatment `audit_logs` receives in the tenancy migration. The policy
 * alone would already refuse to rewrite *another* kitchen's snapshot; the
 * revoke is what stops a kitchen rewriting **its own**, which is the failure
 * that actually matters here — a cost history that can be edited after the
 * fact is not a history. Tampering therefore requires the migrator role, which
 * the application never holds.
 *
 * The `FOR ALL` policy still carries UPDATE and DELETE arms even though those
 * privileges are revoked. That is not redundancy for its own sake: a future
 * migration that grants the privilege back — for a correction tool, say —
 * would otherwise silently restore *unscoped* update rights. Defence in depth
 * costs one predicate here and removes a whole class of future accident.
 *
 * RLS is enabled but not forced: the migrator role owns the table, so
 * migrations, seeders and the K1.8 importer keep working.
 */
return new class extends Migration
{
    private const string TABLE = 'recipe_cost_snapshots';

    /**
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    private const string POLICY = 'rls_organisation_scope';

    public function up(): void
    {
        $this->dropPolicy();

        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        DB::statement(
            'CREATE POLICY '.self::POLICY.' ON '.self::TABLE." FOR ALL TO {$roles}
             USING (".self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );

        DB::statement('REVOKE UPDATE, DELETE ON '.self::TABLE." FROM {$roles}");
    }

    public function down(): void
    {
        $roles = $this->roles();

        if ($roles !== null) {
            DB::statement('GRANT UPDATE, DELETE ON '.self::TABLE." TO {$roles}");
        }

        $this->dropPolicy();

        DB::statement('ALTER TABLE '.self::TABLE.' DISABLE ROW LEVEL SECURITY');
    }

    private function dropPolicy(): void
    {
        DB::statement('DROP POLICY IF EXISTS '.self::POLICY.' ON '.self::TABLE);
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
