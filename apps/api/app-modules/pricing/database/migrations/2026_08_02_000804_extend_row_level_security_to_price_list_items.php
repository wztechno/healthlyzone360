<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The K1.5 extension of the row-level-security set (master plan v2 §4.12,
 * ADR-0007): `price_list_items` joins the nine tables K1.3 left behind, taking
 * the pinned set to **ten**.
 *
 * This is the table the policy set exists for. A negotiated price is a
 * competitor's bargaining position: it says what a kitchen will accept, from
 * whom, and how much room it has left. K1.4 added nine catalogue tables and
 * deliberately gave none of them a policy, on the stated ground that a
 * catalogue item is published content — its name and its allergens are *meant*
 * to reach a diner. The price is the exact opposite, and that is why the
 * boundary was drawn where it was rather than at the module.
 *
 * `org-rls` only — one policy, no revoke. `price_list_items` is not an
 * append-only ledger and must not be described as one: the supersession diff
 * has to close standing rows, which is an UPDATE of `effective_to` and
 * `superseded_by_id`. The immutability that matters here is narrower and is
 * enforced by the service and the partial unique index — history is closed,
 * never rewritten, and never deleted — because the write the ledger revoke
 * would forbid is the write this table's whole design depends on. Recording
 * the distinction rather than reaching for the stronger-looking mechanism: a
 * REVOKE here would break supersession on the first price change, and a
 * migration that granted it back to fix that would look like a regression
 * rather than the correction it was.
 *
 * `current_setting(..., true)` throughout, so a connection carrying no tenant
 * context matches nothing and a session reset to empty strings matches nothing
 * either. Fail-closed is the only acceptable default for this table.
 *
 * The `FOR ALL` policy's WITH CHECK arm is what stops a kitchen planting a row
 * in somebody else's list — the mirror failure of reading one, and the one an
 * application scope is least likely to catch, because the organisation
 * identifier on the row is supplied by the writer.
 *
 * RLS is enabled but not forced: the migrator role owns the table, so
 * migrations, seeders and the K1.8 importer keep working.
 */
return new class extends Migration
{
    private const string TABLE = 'price_list_items';

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
    }

    public function down(): void
    {
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
