<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One delivery day of one subscription — the row the balance is actually made
 * of.
 *
 * **This table is the ledger and `subscriptions.balance_days_consumed` is the
 * cache.** The approved semantics (§1) make a plan a consumable balance of
 * delivery days; a counter alone would be able to say *how many* days were used
 * and never *which*, which is unanswerable exactly when it matters — a customer
 * disputing that they were charged for a day the kitchen skipped. `consumed` is
 * a stored boolean rather than a derivation from `status`, because the two can
 * legitimately disagree for one moment: a day generated and then cancelled by
 * the kitchen keeps its `cancelled` status and has its `consumed` flipped back
 * to false by the reconciliation pass, and an audit that could not see that
 * happen would show a refund with no cause.
 *
 * **`order_id` is nullable and `nullOnDelete`.** Most rows here never have an
 * order: a `scheduled` day has not reached the cut-off, and a skipped day never
 * will. Nulling rather than cascading because the delivery record is the
 * subscription's own history — deleting an order must not silently give a
 * consumed day back.
 *
 * **The unique index is the anti-double-generation guarantee.** One
 * subscription has at most one row per date, enforced by PostgreSQL, so an
 * hourly tick that runs twice, or two application servers that both wake up,
 * cannot place two orders for the same day. `GenerationService` claims the row
 * before it places the order for the same reason `OrderIdempotency` claims its
 * key before the order exists: a check-then-act is something two processes can
 * both pass.
 *
 * `skip_reason` names why a day was skipped in a short vocabulary word rather
 * than free text — `customer_request`, `no_safe_meal`, `unavailable` — because
 * the customer notification and the kitchen's report both switch on it.
 *
 * Isolation strategy: **`join-rls-parent`** — reachable only through
 * `subscriptions`, cascade-deleted with it, `organisation_id` denormalised so a
 * future policy needs no join. No policy of its own; the eleven-table pin in
 * `RlsTest` stays eleven.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_deliveries', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('subscription_id')->constrained('subscriptions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->comment('denormalised from the subscription, so a projection needs no join')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->comment('who produces it — the projection groups on this')->constrained('organisation_branches')->nullOnDelete();

            $table->date('delivery_date');
            $table->string('delivery_window_code', 40)->nullable()->comment('the slot as it stood when the day was scheduled');

            $table->string('status', 24)->default('scheduled')->comment('scheduled | generated | skipped_customer | skipped_no_safe_meal | skipped_unavailable | delivered | cancelled');
            $table->boolean('consumed')->default(false)->comment('does this day come off the balance — stored, not derived, so a give-back is visible');
            $table->string('skip_reason', 40)->nullable()->comment('customer_request | no_safe_meal | unavailable — a vocabulary word, never free text');

            $table->foreignUuid('order_id')->nullable()->comment('the real order, once one exists')->constrained('orders')->nullOnDelete();
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('settled_at')->nullable()->comment('when the day left the scheduled state, whatever it became');

            $table->timestamps();

            $table->index(['subscription_id', 'delivery_date']);
            $table->index(['organisation_id', 'delivery_date', 'status'], 'subscription_deliveries_projection');
            $table->index('order_id');
        });

        DB::statement("ALTER TABLE subscription_deliveries ADD CONSTRAINT subscription_deliveries_status_check CHECK (status IN ('scheduled', 'generated', 'skipped_customer', 'skipped_no_safe_meal', 'skipped_unavailable', 'delivered', 'cancelled'))");
        DB::statement("ALTER TABLE subscription_deliveries ADD CONSTRAINT subscription_deliveries_skip_reason_check CHECK (skip_reason IS NULL OR skip_reason IN ('customer_request', 'no_safe_meal', 'unavailable'))");

        // A skipped day never consumes. The §6 promise — "the delivery for that
        // slot is skipped WITHOUT consuming a balance day" — written where no
        // future caller can forget it.
        DB::statement("ALTER TABLE subscription_deliveries ADD CONSTRAINT subscription_deliveries_skip_is_free_check CHECK (status NOT IN ('scheduled', 'skipped_customer', 'skipped_no_safe_meal', 'skipped_unavailable') OR consumed = false)");

        // One row per subscription per day. This is what stops a second hourly
        // tick, or a second application server, placing a second order for the
        // same delivery.
        DB::statement('CREATE UNIQUE INDEX subscription_deliveries_one_row_per_day ON subscription_deliveries (subscription_id, delivery_date)');
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_deliveries');
    }
};
