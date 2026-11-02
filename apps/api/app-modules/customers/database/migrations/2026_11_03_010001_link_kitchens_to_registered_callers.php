<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A kitchen can sell to a registered customer who rings it for the first time.
 *
 * The owner's request of 2 November: the desk must also find B2C customers. A
 * registered consumer who already ordered here was found all along. The one the
 * desk could not reach is the registered consumer **with no order here**, and
 * both layers shut them out: `DeskCustomerDirectory::applyScope()` by rule, and
 * `rls_customer_account_select` because a consumer row carries no organisation,
 * so a kitchen session matches none of the six arms and reads no row at all.
 *
 * ## A seventh arm, and why this narrow
 *
 * The easy arm, "any registered consumer", would hand every kitchen on the
 * platform a name search over every consumer, with allergies one press away.
 * Not acceptable on a marketplace, so nothing searches consumers by name.
 *
 * The door is the customer's own telephone number. A caller who reads out their
 * number has told the kitchen who they are, so an exact E.164 match — and only
 * that — writes a `kitchen_customer_links` row, and the seventh arm admits what
 * this table holds. The arm stays a stated relationship between one kitchen and
 * one account, as the order, subscription and programme arms are, rather than a
 * class of people. Every link is audited (`customer.desk_link_created`).
 *
 * **The number need not be verified.** No channel can send an SMS yet
 * (`PhoneVerificationPolicy`), so requiring it would find nobody. The desk serves
 * numbers verified or not everywhere else too.
 *
 * ## `registered_consumers_with_phone`
 *
 * `SECURITY DEFINER`, because finding the row is exactly what the policy forbids
 * a kitchen session, and `search_path` pinned as any definer function must be
 * (`recipe_has_published_lines` is the precedent). It answers account identifiers
 * for one exact number, never a name, and skips closed and anonymised accounts.
 *
 * ## It restates every arm before it
 *
 * The policy is dropped and recreated whole, so this file carries all six.
 * SELECT only, again: insert and update keep their three arms. Any later
 * migration that rewrites this policy must carry all seven.
 *
 * Isolation strategy for the new table: `org-rls`, the plain organisation policy.
 */
return new class extends Migration
{
    private const string TABLE = 'customer_accounts';

    private const string LINKS = 'kitchen_customer_links';

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

    private const string SUBSCRIPTION_HOLDER_MATCH = "EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.customer_account_id = customer_accounts.id
          AND s.organisation_id::text = current_setting('app.organisation_id', true)
    )";

    private const string PROGRAMME_MATCH = "(organisation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM corporate_programmes cp
        WHERE cp.organisation_id = customer_accounts.organisation_id
          AND cp.kitchen_organisation_id::text = current_setting('app.organisation_id', true)
    ))";

    /** The seventh arm. `::text` for the reason the order arm gives. */
    private const string LINK_MATCH = "EXISTS (
        SELECT 1 FROM kitchen_customer_links l
        WHERE l.customer_account_id = customer_accounts.id
          AND l.organisation_id::text = current_setting('app.organisation_id', true)
    )";

    private const string LINK_ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create(self::LINKS, function (Blueprint $table): void {
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->constrained('customer_accounts')->cascadeOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');
            $table->primary(['organisation_id', 'customer_account_id']);
        });

        DB::statement('ALTER TABLE '.self::LINKS.' ENABLE ROW LEVEL SECURITY');

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION registered_consumers_with_phone(target_phone text)
            RETURNS SETOF uuid
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
                SELECT DISTINCT a.id
                FROM customer_accounts a
                JOIN contact_points c ON c.customer_account_id = a.id OR c.user_id = a.user_id
                WHERE c.channel = 'phone'
                  AND c.retired_at IS NULL
                  AND c.value_normalised = target_phone
                  AND a.account_type = 'b2c'
                  AND a.user_id IS NOT NULL
                  AND a.status IN ('provisional', 'active')
                  AND a.anonymised_at IS NULL
                LIMIT 20
            $$
            SQL);

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        DB::statement(
            'CREATE POLICY rls_organisation_scope ON '.self::LINKS.' FOR ALL TO '.$roles.'
             USING ('.self::LINK_ORGANISATION_MATCH.')
             WITH CHECK ('.self::LINK_ORGANISATION_MATCH.')'
        );

        $this->replacePolicies($this->readBefore().' OR '.self::LINK_MATCH, $this->write());
    }

    public function down(): void
    {
        $this->replacePolicies($this->readBefore(), $this->write());

        DB::statement('DROP FUNCTION IF EXISTS registered_consumers_with_phone(text)');

        Schema::dropIfExists(self::LINKS);
    }

    /** The six read arms 2026_10_22_000101 left. */
    private function readBefore(): string
    {
        return $this->write().' OR '.self::ORDER_HOLDER_MATCH.' OR '.self::SUBSCRIPTION_HOLDER_MATCH.' OR '.self::PROGRAMME_MATCH;
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
