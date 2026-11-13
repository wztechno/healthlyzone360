<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Something went wrong with an order: why, what it cost the kitchen, and how it
 * ended. `outcome` is null while the complaint is open.
 *
 * A remake is a real order at zero, so `remake_order_id` is the link and the food
 * it used reaches stock and cost like any other order's. `order_refund_id` links
 * the refund ledger when the answer was money. `cost_minor` is what the kitchen
 * says it cost, in the order's currency: the remake's food cost is not computed
 * here.
 *
 * Isolation strategy: `org-rls`, as `order_refunds`.
 */
return new class extends Migration
{
    private const string TABLE = 'order_complaints';

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

            $table->string('cause', 24)->comment('wrong_item | missing_item | quality | late | foreign_object | other');
            $table->string('description', 500)->nullable();
            $table->bigInteger('cost_minor')->default(0)->comment('in minor units of the order\'s currency');
            $table->string('currency_code', 3);
            $table->string('outcome', 24)->nullable()->comment('remade | refunded | apologised | no_action; null while open');

            $table->foreignUuid('remake_order_id')->nullable()->constrained('orders')->restrictOnDelete();
            $table->foreignUuid('order_refund_id')->nullable()->constrained('order_refunds')->restrictOnDelete();

            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('closed_at')->nullable();
            $table->timestamps();

            $table->index('order_id');
            $table->index(['organisation_id', 'created_at']);
            $table->unique('remake_order_id');
        });

        DB::statement("ALTER TABLE order_complaints ADD CONSTRAINT order_complaints_cause_check CHECK (cause IN ('wrong_item', 'missing_item', 'quality', 'late', 'foreign_object', 'other'))");
        DB::statement("ALTER TABLE order_complaints ADD CONSTRAINT order_complaints_outcome_check CHECK (outcome IS NULL OR outcome IN ('remade', 'refunded', 'apologised', 'no_action'))");
        DB::statement('ALTER TABLE order_complaints ADD CONSTRAINT order_complaints_cost_check CHECK (cost_minor >= 0)');
        DB::statement('ALTER TABLE order_complaints ADD CONSTRAINT order_complaints_closed_check CHECK ((outcome IS NULL) = (closed_at IS NULL))');

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
