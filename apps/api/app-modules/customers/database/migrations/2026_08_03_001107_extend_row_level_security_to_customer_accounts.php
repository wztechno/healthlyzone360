<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The J1 extension of the row-level-security set (master plan v2 §4.12,
 * appendix D, ADR-0007): `customer_accounts` joins the ten tables K1.5 left
 * behind, taking the pinned set to **eleven**.
 *
 * **Two predicates, because the table holds two kinds of party.** A consumer
 * account belongs to a person and to no organisation at all, so it is reachable
 * through `app.user_id` alone — a customer reading their own account has no
 * tenant context to resolve, and an organisation-only policy would hide every
 * D2C row from its own owner. A corporate account belongs to a company, so it
 * is reachable inside that organisation, which is how a kitchen's staff see
 * the buyer they are serving. Either predicate alone would shut out one of the
 * two shapes; that is why the policy is `OR` rather than a choice.
 *
 * The organisation arm is guarded with `organisation_id IS NOT NULL`, mirroring
 * `consent_grants`. Without it, a NULL organisation on a consumer row would be
 * compared against a NULL setting and the whole predicate would depend on
 * three-valued logic rather than on a stated rule.
 *
 * **No DELETE policy, deliberately.** A customer account is closed and
 * anonymised (J2), never removed by the application role: orders, consents and
 * audit events point at it, and a deletable customer would leave those
 * dangling or silently cascade them away. The `FOR SELECT`/`INSERT`/`UPDATE`
 * split is what makes that structural rather than a convention somebody
 * remembers.
 *
 * The child tables — addresses, dietary profile, allergen declarations, food
 * exclusions — take no policy of their own. They are `join-rls-parent`:
 * reachable only through this row, cascade-deleted with it, and protected by
 * the predicate above them. A second policy would be a second place to get the
 * same predicate wrong.
 *
 * `current_setting(..., true)` throughout, so a connection with no context
 * matches nothing and a reset session carrying empty strings matches nothing
 * either. RLS is enabled but not forced: the migrator role owns the table, so
 * migrations and seeders keep working.
 */
return new class extends Migration
{
    private const string TABLE = 'customer_accounts';

    /**
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string USER_MATCH = "user_id::text = current_setting('app.user_id', true)";

    private const string ORGANISATION_MATCH = "(organisation_id IS NOT NULL AND organisation_id::text = current_setting('app.organisation_id', true))";

    /**
     * @var list<string>
     */
    private const array POLICIES = ['rls_customer_account_select', 'rls_customer_account_insert', 'rls_customer_account_update'];

    public function up(): void
    {
        $this->dropPolicies();

        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        $access = self::USER_MATCH.' OR '.self::ORGANISATION_MATCH;

        DB::statement(
            'CREATE POLICY rls_customer_account_select ON '.self::TABLE." FOR SELECT TO {$roles}
             USING ({$access})"
        );

        DB::statement(
            'CREATE POLICY rls_customer_account_insert ON '.self::TABLE." FOR INSERT TO {$roles}
             WITH CHECK ({$access})"
        );

        DB::statement(
            'CREATE POLICY rls_customer_account_update ON '.self::TABLE." FOR UPDATE TO {$roles}
             USING ({$access})
             WITH CHECK ({$access})"
        );
    }

    public function down(): void
    {
        $this->dropPolicies();

        DB::statement('ALTER TABLE '.self::TABLE.' DISABLE ROW LEVEL SECURITY');
    }

    private function dropPolicies(): void
    {
        foreach (self::POLICIES as $policy) {
            DB::statement("DROP POLICY IF EXISTS {$policy} ON ".self::TABLE);
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
