<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A kitchen may read the corporate buyers it holds a programme with.
 *
 * The kitchen customer book (`GET /catalogue/customers`) lists, besides the
 * desk's two arms, every B2B account whose buying organisation holds a
 * `corporate_programmes` row with this kitchen. Such an account carries the
 * *buyer's* `organisation_id`, so a kitchen session matches none of the read
 * arms before this one — a programme client who has not ordered yet would come
 * back as no row at all in production, while every test passed, because the
 * suite connects as the schema owner.
 *
 * **It restates every arm before it.** The policy is dropped and recreated
 * whole, so this file must carry 2026_10_21_000301's subscription arm too —
 * leaving it out would silently take a kitchen's subscribers away from it. Any
 * later migration that rewrites this policy must carry all six.
 *
 * **SELECT only, again.** The sixth arm admits the read; insert and update keep
 * their three arms, so holding a programme never lets a kitchen rewrite the
 * buyer's account. The app layer says the same thing:
 * `DeskCustomerDirectory::isInScope()`, which guards the desk's writes, does
 * not include the programme arm.
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

    /** The fifth arm, from 2026_10_21_000301, restated unchanged. */
    private const string SUBSCRIPTION_HOLDER_MATCH = "EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.customer_account_id = customer_accounts.id
          AND s.organisation_id::text = current_setting('app.organisation_id', true)
    )";

    /**
     * The sixth arm: the account's buyer holds a programme with the kitchen on
     * the session. `::text` on the column, for the reason the order arm gives.
     */
    private const string PROGRAMME_MATCH = "(organisation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM corporate_programmes cp
        WHERE cp.organisation_id = customer_accounts.organisation_id
          AND cp.kitchen_organisation_id::text = current_setting('app.organisation_id', true)
    ))";

    public function up(): void
    {
        $this->replacePolicies($this->readBefore().' OR '.self::PROGRAMME_MATCH, $this->write());
    }

    public function down(): void
    {
        $this->replacePolicies($this->readBefore(), $this->write());
    }

    /** The five read arms 2026_10_21_000301 left. */
    private function readBefore(): string
    {
        return $this->write().' OR '.self::ORDER_HOLDER_MATCH.' OR '.self::SUBSCRIPTION_HOLDER_MATCH;
    }

    private function write(): string
    {
        return self::USER_MATCH.' OR '.self::ORGANISATION_MATCH.' OR '.self::GUEST_MATCH;
    }

    /**
     * Drop and recreate, the idiom 2026_08_16_003006 uses.
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
