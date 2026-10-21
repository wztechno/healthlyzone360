<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A kitchen can read the customers it holds a subscription for.
 *
 * The fifth arm on `rls_customer_account_select`, beside the order-holder arm
 * 2026_08_16_003006 added, and for the same reason: a consumer account carries
 * no `organisation_id`, so a kitchen session matches none of the first three
 * arms for a registered customer.
 *
 * The order-holder arm covers a subscriber who has also ordered once. It does
 * not cover the commonest subscriber of all — somebody whose first purchase is
 * the plan — and for them subscription generation, running as the kitchen,
 * read **no row** for the account and skipped every day as
 * `customer_record_unreadable`. No test caught it: the suite connects as the
 * schema owner and bypasses RLS, exactly as that migration says of its own bug.
 *
 * The predicate is the same shape as the order arm and as narrow: **this
 * organisation holds a subscription against this account**. A subscription is
 * a standing instruction from the customer to that kitchen to feed them, which
 * is the purpose that justifies the disclosure, and it grants nothing about a
 * person the kitchen has no arrangement with.
 *
 * **SELECT only**, as before. The insert and update policies keep their three
 * arms: a kitchen may read a subscriber's account and may not edit it.
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

    private const string GUEST_MATCH = '(user_id IS NULL AND organisation_id IS NULL)';

    private const string ORDER_HOLDER_MATCH = "EXISTS (
        SELECT 1 FROM orders o
        WHERE o.customer_account_id = customer_accounts.id
          AND o.organisation_id::text = current_setting('app.organisation_id', true)
    )";

    /**
     * The fifth arm. `::text` on the subscription's organisation for the reason
     * the order arm gives: casting the setting would raise on the empty string a
     * reset connection carries, and this must fail closed, not error.
     */
    private const string SUBSCRIPTION_HOLDER_MATCH = "EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.customer_account_id = customer_accounts.id
          AND s.organisation_id::text = current_setting('app.organisation_id', true)
    )";

    public function up(): void
    {
        $this->replacePolicies(
            self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH
                .' OR '.self::ORDER_HOLDER_MATCH.' OR '.self::SUBSCRIPTION_HOLDER_MATCH,
            self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH,
        );
    }

    public function down(): void
    {
        $this->replacePolicies(
            self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH.' OR '.self::ORDER_HOLDER_MATCH,
            self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH,
        );
    }

    /**
     * Drop and recreate the whole set, the idiom 2026_08_07_001506 established,
     * so the policy reads in one place.
     */
    private function replacePolicies(string $read, string $write): void
    {
        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        foreach (['rls_customer_account_select', 'rls_customer_account_insert', 'rls_customer_account_update'] as $policy) {
            DB::statement("DROP POLICY IF EXISTS {$policy} ON ".self::TABLE);
        }

        DB::statement(
            'CREATE POLICY rls_customer_account_select ON '.self::TABLE." FOR SELECT TO {$roles}
             USING ({$read})"
        );

        DB::statement(
            'CREATE POLICY rls_customer_account_insert ON '.self::TABLE." FOR INSERT TO {$roles}
             WITH CHECK ({$write})"
        );

        DB::statement(
            'CREATE POLICY rls_customer_account_update ON '.self::TABLE." FOR UPDATE TO {$roles}
             USING ({$write})
             WITH CHECK ({$write})"
        );
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list. A
     * database provisioned without the docker init script has neither, and
     * leaving the policies alone is the correct fail-closed outcome there.
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
