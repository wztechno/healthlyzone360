<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The guest journey does not work under row-level security, and this is why.
 *
 * J1's policy on `customer_accounts` admits a row that belongs to the session's
 * user, or to the session's organisation. A **guest account has neither** —
 * `user_id` is NULL by CHECK constraint and `organisation_id` is NULL because
 * a guest belongs to nobody — so it matches no predicate at all. Under the
 * runtime role that is not "protected", it is *unreachable*: the whole G1
 * surface would answer `401 guest.session_invalid` in production while passing
 * every test, because the test suite connects as the schema owner and bypasses
 * RLS by ownership. Exactly the class of defect §4.12 exists to catch, found
 * by reading the predicates rather than by running anything.
 *
 * ## Why a third arm rather than a fourth session variable
 *
 * The obvious alternative is to publish the resolved guest account to the
 * database session — `app.customer_account_id` beside `app.user_id` — and
 * match on it. It was rejected for a chicken-and-egg reason that is not
 * incidental: the account is discovered *by* validating the token, and
 * validating the token reads this table. The session variable cannot be set
 * before the read it is supposed to authorise. The only way round it is to
 * publish the **token digest** onto the connection instead — which puts the
 * credential itself on a shared database session, visible to every statement
 * on it, to protect a row whose only secret is that credential. That is
 * strictly worse than the token.
 *
 * ## What the third arm actually concedes, and why it is the right size
 *
 * `(user_id IS NULL AND organisation_id IS NULL)` admits **ownerless rows
 * only**. It cannot widen access to a single row that belongs to anybody: a
 * registered customer's account still matches only their own session, and a
 * corporate account still matches only its own organisation. The regression
 * test pins both.
 *
 * What it concedes is that guest accounts are not isolated from each other *at
 * the database layer*. They are isolated by the capability token, in the
 * application layer — which is precisely the isolation strategy §4.12 names
 * for them (`capability-token`), and precisely what `guest_sessions`, `carts`
 * and `orders` already rely on: none of those three carries a policy either,
 * and between them they hold the same person's basket, address and telephone
 * number. Admitting the account row adds no capability the runtime role did
 * not already have; refusing it only breaks the feature.
 *
 * The honest summary is that a guest's protection is a 256-bit token digest
 * and a service that will not resolve one it cannot match. That is a real
 * control and it is written down, rather than an RLS predicate that reads like
 * a control and silently denies the feature instead.
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

    /**
     * @var list<string>
     */
    private const array POLICIES = ['rls_customer_account_select', 'rls_customer_account_insert', 'rls_customer_account_update'];

    public function up(): void
    {
        $this->replacePolicies(self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH);
    }

    public function down(): void
    {
        $this->replacePolicies(self::USER_MATCH.' OR '.self::ORGANISATION_MATCH);
    }

    private function replacePolicies(string $access): void
    {
        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        foreach (self::POLICIES as $policy) {
            DB::statement("DROP POLICY IF EXISTS {$policy} ON ".self::TABLE);
        }

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
