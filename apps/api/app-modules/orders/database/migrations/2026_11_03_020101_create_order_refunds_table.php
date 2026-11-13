<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Money going back, and a receipt that should never have been written.
 *
 * `order_payment_receipts` refuses a negative amount and has no update path, on
 * the stated ground that giving money back is a different act. This is that act.
 * The payments module's `refunds` table cannot hold it: every row there needs a
 * `payment_intent_id`, and a desk or delivery order has receipts and no intent.
 *
 * ## One ledger, two kinds
 *
 * - `refund`: real money went back. The order's total and its receipts stand, so
 *   the order stays paid and nobody is asked to collect it again.
 * - `receipt_correction`: a receipt was keyed wrongly and the money never
 *   arrived. The order's balance comes back as outstanding.
 *
 * Both are capped together: the two can never exceed what the receipts say
 * arrived. The check sits in `OrderRefunds`, under a lock on the order row.
 *
 * ## Append-only, with one exception, enforced here
 *
 * An entry above the kitchen's limit is written `pending_approval`, and the
 * owner's answer moves it once, to `completed` or `rejected`. After that nothing
 * changes it, and no row is ever deleted. A trigger states that rather than a
 * revoke, because the revoke `stock_movements` carries would also take the one
 * legal update away. A rejected row stays as the record that it was asked for.
 *
 * Isolation strategy: `org-rls`, as `kitchen_service_settings`: enabled, not
 * forced, so the migrator keeps working.
 */
return new class extends Migration
{
    private const string TABLE = 'order_refunds';

    /**
     * The schema owner is absent on purpose: it bypasses RLS by ownership.
     *
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->restrictOnDelete();

            $table->string('kind', 24)->comment('refund | receipt_correction');
            $table->string('status', 24)->comment('pending_approval | completed | rejected');
            $table->string('method', 24)->comment('how it went back: the receipt vocabulary, cash_on_delivery | cash_at_counter | wish');
            $table->bigInteger('amount_minor')->comment('in minor units of currency_code');
            $table->string('currency_code', 3)->comment('ISO 4217, taken from the order');
            $table->string('reason', 300);

            $table->foreignUuid('requested_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('requested_at');
            $table->foreignUuid('decided_by')->nullable()->comment('who completed or rejected it; the requester when no approval was needed')->constrained('users')->restrictOnDelete();
            $table->timestampTz('decided_at')->nullable();

            $table->timestamps();

            $table->index('order_id');
            $table->index(['organisation_id', 'status']);
            $table->index(['organisation_id', 'decided_at']);

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_kind_check CHECK (kind IN ('refund', 'receipt_correction'))");
        DB::statement("ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_status_check CHECK (status IN ('pending_approval', 'completed', 'rejected'))");
        DB::statement("ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_method_check CHECK (method IN ('cash_on_delivery', 'cash_at_counter', 'wish'))");
        DB::statement('ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_amount_check CHECK (amount_minor > 0)');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION order_refunds_append_only() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' OR OLD.status <> 'pending_approval' THEN
                    RAISE EXCEPTION 'order_refunds is append-only';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER order_refunds_append_only
                BEFORE UPDATE OR DELETE ON order_refunds
                FOR EACH ROW EXECUTE FUNCTION order_refunds_append_only();
            SQL);

        DB::statement('ALTER TABLE '.self::TABLE.' ENABLE ROW LEVEL SECURITY');

        $roles = $this->roles();

        if ($roles === null) {
            return;
        }

        DB::statement(
            'CREATE POLICY rls_organisation_scope ON '.self::TABLE.' FOR ALL TO '.$roles.'
             USING ('.self::ORGANISATION_MATCH.')
             WITH CHECK ('.self::ORGANISATION_MATCH.')'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists(self::TABLE);
        DB::unprepared('DROP FUNCTION IF EXISTS order_refunds_append_only()');
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
