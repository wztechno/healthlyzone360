<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 1B of the incremental RLS strategy (plan §11, ADR-0007).
 *
 * Row-level security is enabled on exactly six representative tables. They
 * are the ones where a scoping mistake would be a cross-tenant data leak, and
 * together they exercise every propagation pattern the wider rollout will
 * need: organisation-only scoping, user-or-organisation scoping, platform
 * template rows, and an append-only ledger.
 *
 * Session context is read with current_setting(..., true), so an unset
 * variable yields NULL rather than an error and every predicate evaluates
 * false — a connection with no context reads nothing and writes nothing.
 * The reset path writes empty strings, which compare false against any UUID
 * for the same reason.
 *
 * RLS is enabled but deliberately NOT forced: healthy360_migrator owns these
 * tables, so migrations and seeders keep working, while healthy360_app and
 * healthy360_test own nothing and are fully subject to the policies.
 *
 * No other table joins the set in this phase; every new tenant-scoped table
 * must decide at migration time whether to join it (ADR-0007 review trigger).
 */
return new class extends Migration
{
    /**
     * The six tables, in the order the policies are declared below.
     *
     * @var list<string>
     */
    private const array TABLES = [
        'organisation_branches',
        'organisation_memberships',
        'roles',
        'feature_entitlements',
        'consent_grants',
        'audit_logs',
    ];

    /**
     * Runtime roles the policies apply to. The schema owner is absent on
     * purpose: it bypasses RLS by ownership, which is what lets migrations
     * and seeders run at all.
     *
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    private const string USER_MATCH = "user_id::text = current_setting('app.user_id', true)";

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

        // Plain organisation ownership: read, write and delete only inside the
        // active organisation. FOR ALL applies USING to SELECT/UPDATE/DELETE
        // and WITH CHECK to INSERT/UPDATE, which is exactly the intent.
        foreach (['organisation_branches', 'feature_entitlements'] as $table) {
            DB::statement(
                "CREATE POLICY rls_organisation_scope ON {$table} FOR ALL TO {$roles}
                 USING (".self::ORGANISATION_MATCH.')
                 WITH CHECK ('.self::ORGANISATION_MATCH.')'
            );
        }

        // A person may list their own memberships across organisations —
        // GET /api/v1/me depends on it — so the read predicate is wider than
        // the write predicate, which stays strictly organisation-scoped.
        DB::statement(
            'CREATE POLICY rls_membership_select ON organisation_memberships FOR SELECT TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.' OR '.self::USER_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_membership_insert ON organisation_memberships FOR INSERT TO '.$roles.'
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_membership_update ON organisation_memberships FOR UPDATE TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_membership_delete ON organisation_memberships FOR DELETE TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')'
        );

        // Platform template roles (organisation_id NULL) must stay readable in
        // every tenant context — memberships are assigned template roles — but
        // the runtime roles can never create, alter or delete one: the write
        // predicates require an organisation match, which NULL never satisfies.
        DB::statement(
            'CREATE POLICY rls_role_select ON roles FOR SELECT TO '.$roles.'
             USING (organisation_id IS NULL OR '.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_role_insert ON roles FOR INSERT TO '.$roles.'
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_role_update ON roles FOR UPDATE TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_role_delete ON roles FOR DELETE TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')'
        );

        // Consent belongs to the data subject first and to the organisation
        // that collected it second. Platform consents (organisation_id NULL,
        // written during registration) are reachable only through the subject
        // predicate, which is why the consent ledger declares the subject to
        // the session before it writes.
        $consentAccess = self::USER_MATCH.' OR (organisation_id IS NOT NULL AND '.self::ORGANISATION_MATCH.')';

        DB::statement(
            'CREATE POLICY rls_consent_select ON consent_grants FOR SELECT TO '.$roles.'
             USING ('.$consentAccess.')'
        );
        DB::statement(
            'CREATE POLICY rls_consent_insert ON consent_grants FOR INSERT TO '.$roles.'
             WITH CHECK ('.$consentAccess.')'
        );

        // Withdrawal is a status transition performed by the data subject
        // (06-security-privacy-and-audit.md §6): organisation staff may read a
        // grant but never rewrite it. There is deliberately no DELETE policy —
        // consent history cannot be erased by the application role at all.
        DB::statement(
            'CREATE POLICY rls_consent_withdraw ON consent_grants FOR UPDATE TO '.$roles.'
             USING ('.self::USER_MATCH.')
             WITH CHECK ('.self::USER_MATCH.')'
        );

        // Append-only ledger. Writing is always allowed — an audit event must
        // never be lost because the context was incomplete, and system events
        // legitimately carry a NULL organisation — while reading is confined
        // to the active organisation. UPDATE and DELETE are removed at grant
        // level below, so tampering needs the migrator role (plan §12).
        DB::statement(
            'CREATE POLICY rls_audit_insert ON audit_logs FOR INSERT TO '.$roles.'
             WITH CHECK (true)'
        );
        DB::statement(
            'CREATE POLICY rls_audit_select ON audit_logs FOR SELECT TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')'
        );

        DB::statement("REVOKE UPDATE, DELETE ON audit_logs FROM {$roles}");
    }

    public function down(): void
    {
        $roles = $this->roles();

        if ($roles !== null) {
            DB::statement("GRANT UPDATE, DELETE ON audit_logs TO {$roles}");
        }

        $this->dropPolicies();

        foreach (self::TABLES as $table) {
            DB::statement("ALTER TABLE {$table} DISABLE ROW LEVEL SECURITY");
        }
    }

    /**
     * Policies are dropped by name before they are created so a partially
     * applied migration can be re-run, and so down() is a clean inverse.
     */
    private function dropPolicies(): void
    {
        $policies = [
            'organisation_branches' => ['rls_organisation_scope'],
            'feature_entitlements' => ['rls_organisation_scope'],
            'organisation_memberships' => ['rls_membership_select', 'rls_membership_insert', 'rls_membership_update', 'rls_membership_delete'],
            'roles' => ['rls_role_select', 'rls_role_insert', 'rls_role_update', 'rls_role_delete'],
            'consent_grants' => ['rls_consent_select', 'rls_consent_insert', 'rls_consent_withdraw'],
            'audit_logs' => ['rls_audit_insert', 'rls_audit_select'],
        ];

        foreach ($policies as $table => $names) {
            foreach ($names as $name) {
                DB::statement("DROP POLICY IF EXISTS {$name} ON {$table}");
            }
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
