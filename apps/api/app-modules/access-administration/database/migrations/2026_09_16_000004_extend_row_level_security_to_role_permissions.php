<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `role_permissions` joins the policy set.
 *
 * `2026_09_16_000001` recorded the opposite decision and gave two reasons for
 * it. The first — that isolation is already real, because every path resolves
 * its `role_id` through a `roles` row the policy has admitted — was true and
 * remains true; it is an argument that a policy is *redundant*, not that it is
 * wrong. The second was the load-bearing one: the suite connects as the schema
 * owner and bypasses RLS by ownership, so a policy shipped then would have been
 * a policy nothing could prove correct.
 *
 * That reason has an answer, and it was already in the repository.
 * `Healthy360\Tenancy\Tests\Fixtures\RuntimeRole` runs a closure under
 * `SET ROLE healthy360_test` with the three session variables set raw, which is
 * exactly what `tenancy/tests/RlsTest.php` uses to prove the six original
 * tables. `RolePermissionRlsTest` uses it here. So the untestable policy is
 * testable, and AA1 made this table tenant-*writable* for the first time —
 * which is the ADR-0007 review trigger, now answered in the affirmative.
 *
 * ## The shape is `roles`', because the column is already there
 *
 * No `EXISTS` subquery against `roles` is needed. `role_permissions` has
 * carried a denormalised, nullable `organisation_id` since it was created,
 * commented `'denormalised for RLS; null for platform template grants'` — the
 * table was built for this and then left out of the set. So the four policies
 * below are a copy of `rls_role_*`:
 *
 *   SELECT admits `organisation_id IS NULL OR` a match, so a platform
 *   template's grants stay readable in every tenant context — without which
 *   `PermissionChecker` could not resolve a template role at all;
 *
 *   INSERT, UPDATE and DELETE require the match, which `NULL` never satisfies,
 *   so a tenant physically cannot alter a platform template's grants however
 *   the application layer is persuaded to ask.
 *
 * `RoleWriter` already stamps `organisation_id` on every grant it inserts, so
 * the write predicate is satisfied by the code that exists rather than by code
 * this migration obliges somebody to write.
 *
 * ## `membership_roles` is deliberately not here
 *
 * The other half of the same join is also outside the set, also carries an
 * `organisation_id` — non-nullable — and `MembershipRoleAssigner` already
 * stamps it, so it would be the plain `rls_organisation_scope` FOR ALL shape
 * and cheap to add. It waits because `PermissionChecker` reads it *first*, to
 * resolve the effective role set, before it reads a single grant: it sits on a
 * hotter path, and the honest order is to land this one, watch
 * `RolePermissionRlsTest`'s parity assertion hold, and then extend in its own
 * migration with its own test. Splitting the pair is untidy; shipping two
 * policies on one hot path with one round of evidence is worse.
 */
return new class extends Migration
{
    private const string TABLE = 'role_permissions';

    /**
     * The runtime roles the policies apply to. The schema owner is absent on
     * purpose — it bypasses RLS by ownership, which is what lets migrations and
     * seeders run at all.
     *
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    /**
     * @var list<string>
     */
    private const array POLICIES = [
        'rls_role_permission_select',
        'rls_role_permission_insert',
        'rls_role_permission_update',
        'rls_role_permission_delete',
    ];

    public function up(): void
    {
        $this->dropPolicies();

        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $roles = $this->roles();

        // A database provisioned without infrastructure/docker/postgres/init has
        // neither runtime role. RLS enabled with no policies is still the right
        // fail-closed outcome there — every non-owner reads nothing — so the
        // migration completes rather than aborting a schema build.
        if ($roles === null) {
            return;
        }

        DB::statement(
            'CREATE POLICY rls_role_permission_select ON '.self::TABLE.' FOR SELECT TO '.$roles.'
             USING (organisation_id IS NULL OR '.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_role_permission_insert ON '.self::TABLE.' FOR INSERT TO '.$roles.'
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_role_permission_update ON '.self::TABLE.' FOR UPDATE TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
        DB::statement(
            'CREATE POLICY rls_role_permission_delete ON '.self::TABLE.' FOR DELETE TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')'
        );
    }

    public function down(): void
    {
        $this->dropPolicies();

        DB::statement('ALTER TABLE '.self::TABLE.' DISABLE ROW LEVEL SECURITY');
    }

    /**
     * Dropped by name before they are created, so a partially applied migration
     * re-runs cleanly and `down()` is an exact inverse.
     */
    private function dropPolicies(): void
    {
        foreach (self::POLICIES as $name) {
            DB::statement('DROP POLICY IF EXISTS '.$name.' ON '.self::TABLE);
        }
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list.
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
