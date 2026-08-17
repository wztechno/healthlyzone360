<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A customer the kitchen wrote down, and a kitchen that can read the customers
 * it already cooks for.
 *
 * Two changes, both about the same person: somebody who rings a kitchen having
 * never used the platform. C2's desk has to be able to write them down, and the
 * queue beside it has to be able to read back the name of anybody it holds an
 * order for.
 *
 * ## 1. The `b2c` shape admits a staff-provisioned account
 *
 * `customer_accounts_b2c_shape_check` has said `account_type <> 'b2c' OR
 * user_id IS NOT NULL` since J1, and it was right: a consumer account is a
 * person's own account and a person's own account has their login on it. A cold
 * caller has no login and is never going to get one by telephone, so the desk
 * needs a durable consumer account with `user_id` NULL — and the arm that
 * admits it is `origin = 'staff'`, which is a column the table has carried,
 * CHECK-constrained, since the same migration.
 *
 * **Not the guest shape, and this is the load-bearing part.** `guest` already
 * permits a null user, and reaching for it would have been one line instead of
 * this file. It is wrong because a guest is *temporary by construction*:
 * `ExpireGuestData` and `PurgeExpiredGuestSessions` exist to delete guest rows
 * on a schedule, and a kitchen's regular Thursday caller would be reaped
 * somewhere between two orders. A staff-provisioned account is the opposite
 * kind of thing — somebody's work, a relationship the kitchen intends to keep —
 * and `CustomerAccountOrigin::isPurgeable()` already says so: `staff` is not
 * purgeable, `PurgeAbandonedProvisionalAccounts` filters on that list, and it
 * additionally requires a non-null `provisional_expires_at`, which the desk
 * never writes. Two independent guards, neither of them added here, both
 * verified before this migration was written.
 *
 * **The partial unique index is untouched, and that is deliberate.**
 * `customer_accounts_b2c_user_unique` is `(user_id) WHERE account_type = 'b2c'`
 * — one consumer account per person — and PostgreSQL treats NULLs as distinct
 * in a unique index unless told otherwise. So any number of staff-provisioned
 * rows coexist under it while the rule it exists to enforce, one account per
 * *registered* person, is unchanged. Nothing here widens that rule and nothing
 * here needs to: two cold callers are two people.
 *
 * ## 2. The fourth arm on `rls_customer_account_select`
 *
 * The policy has three arms today (2026_08_07_001506): the account's own user,
 * the owning organisation, and ownerless rows. A kitchen session matches none
 * of them for an ordinary registered customer — a consumer account carries no
 * `organisation_id`, by design, because the same person orders from four
 * kitchens with one account — so `SELECT display_name` from a kitchen session
 * returns **no row at all**, and the order desk queue serves `display_name:
 * null` for every registered customer it holds an order for. The number is
 * unaffected (`contact_points` carries no policy); the name simply is not
 * there. No test could have caught it: the suite connects as the schema owner
 * and bypasses RLS by ownership, so it is found by reading predicates.
 *
 * The fourth arm is the smallest predicate that fixes it: **this organisation
 * holds an order against this account**. Not "is a kitchen", not "may read
 * customers" — an order is the *purpose* that justifies the disclosure, it is a
 * fact the kitchen already possesses (`orders` carries no policy and holds the
 * delivery address), and it expires nothing and grants nothing about anybody
 * the kitchen has never cooked for.
 *
 * **SELECT only.** The insert and update policies keep their three arms. A
 * kitchen may now read the name of a customer who ordered from it; it may not
 * edit that customer's account, and a fourth arm on UPDATE would have let one
 * kitchen rewrite a person's row because they bought a sandwich there once.
 *
 * ## What this migration does *not* protect, said plainly
 *
 * A staff-provisioned account has `user_id` NULL and `organisation_id` NULL, so
 * the **third** arm — the ownerless one J1's guest work added — already admits
 * it to every kitchen session on the platform. That is not a side effect of
 * this migration; it is the state of the policy before it, and widening the
 * shape CHECK is what makes rows of that shape exist. **Staff-provisioned
 * accounts therefore have no database-layer isolation between kitchens.**
 *
 * The whole control is above the database and is named in two places: the
 * `customer.create_on_behalf_organisation` permission code, which decides who
 * may write one, and the app-layer scoping rule on the desk's customer search —
 * an account is returned only when this organisation holds an order for it, or
 * when it was staff-provisioned by a user holding an active membership of this
 * organisation. That rule is stated in `DeskCustomerDirectory`, which is the
 * one place it is implemented, and the identifier a stranger's account would
 * need is only obtainable through it.
 *
 * This is the same posture, and the same honesty, as the guest arm above it:
 * `guest_sessions`, `carts` and `orders` carry no policy either and between
 * them hold the same person's basket, address and telephone number. Writing the
 * concession down is what makes it a decision.
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
     * The fourth arm. Read outwards: an order exists, it is against this
     * account, and the organisation that took it is the one on the session.
     *
     * `::text` on the order's organisation rather than a cast of the setting,
     * matching `ORGANISATION_MATCH` exactly — the setting is a `text` GUC and
     * casting it to `uuid` would raise `22P02` on the empty string a reset
     * connection carries, turning a fail-closed read into an error.
     *
     * It fails closed with no context for the same reason the third arm does:
     * an unset setting reads NULL and the comparison is NULL, and a reset
     * connection reads the empty string, which no organisation identifier
     * equals.
     */
    private const string ORDER_HOLDER_MATCH = "EXISTS (
        SELECT 1 FROM orders o
        WHERE o.customer_account_id = customer_accounts.id
          AND o.organisation_id::text = current_setting('app.organisation_id', true)
    )";

    public function up(): void
    {
        DB::statement('ALTER TABLE '.self::TABLE.' DROP CONSTRAINT IF EXISTS customer_accounts_b2c_shape_check');
        DB::statement(
            'ALTER TABLE '.self::TABLE." ADD CONSTRAINT customer_accounts_b2c_shape_check
             CHECK (account_type <> 'b2c' OR user_id IS NOT NULL OR origin = 'staff')"
        );

        $this->replacePolicies(
            self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH.' OR '.self::ORDER_HOLDER_MATCH,
            self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH,
        );
    }

    /**
     * Reverting narrows the shape CHECK again, and PostgreSQL validates it
     * against the rows that are there — so a database that has provisioned even
     * one cold caller refuses this down migration until those rows are dealt
     * with. That is the correct outcome rather than an obstacle: silently
     * deleting somebody's customers to make a constraint fit is not a rollback.
     */
    public function down(): void
    {
        $write = self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH;

        $this->replacePolicies($write, $write);

        DB::statement('ALTER TABLE '.self::TABLE.' DROP CONSTRAINT IF EXISTS customer_accounts_b2c_shape_check');
        DB::statement(
            'ALTER TABLE '.self::TABLE." ADD CONSTRAINT customer_accounts_b2c_shape_check
             CHECK (account_type <> 'b2c' OR user_id IS NOT NULL)"
        );
    }

    /**
     * Drop and recreate, which is the idiom 2026_08_07_001506 established here.
     * `ALTER POLICY` can rewrite a `USING` clause, but it cannot state the whole
     * policy set in one readable place, and a policy whose current text has to
     * be assembled by reading three migrations in order is a policy nobody can
     * review.
     *
     * The read and write expressions are separate parameters because they are
     * now genuinely different: a kitchen may see a customer it has an order
     * for, and may not write to one.
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
