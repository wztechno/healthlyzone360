<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An order: what one customer committed to buy from one kitchen, and on what
 * terms.
 *
 * **Cash on delivery, and nothing else** (master plan v2 C1, F-bis #3). The
 * `payment_method` CHECK admits exactly one value, and there is deliberately
 * **no card token, no provider reference, no authorisation identifier and no
 * payment-status column anywhere on this table**. Not "nullable until PAY1" —
 * absent. A nullable payment column is an invitation: something eventually
 * writes to it, and the first thing to write a card reference into a schema
 * with no PCI scope, no key management and no threat model has created a
 * liability that no later migration removes. PAY1 introduces payments as its
 * own tables under its own review, and until it does the honest statement is
 * that this platform takes cash at the door.
 *
 * **The delivery address is a snapshot, not a foreign key to one.** A customer
 * edits an address, moves house, or deletes it; none of that may change where
 * an order that already shipped was sent. So `label`, the two lines, the city
 * and the area's names in both languages are **copied** onto the order at
 * placement. `delivery_area_id` is kept beside them as a `nullOnDelete`
 * reference — useful for grouping and for a later delivery run, and allowed to
 * go null precisely because the human-readable copy is the record and the
 * reference is only a convenience.
 *
 * `delivery_zone_id` is `nullOnDelete` for the same reason and one more: the
 * fee that was charged is already snapshotted in `delivery_fee_minor`, so
 * losing the zone loses nothing that matters. A `restrictOnDelete` here would
 * mean a kitchen could never retire a zone it had ever delivered through.
 *
 * **Three amounts, all `bigint` minor units, all in one `currency_code`.**
 * `subtotal_minor` is the sum of the lines as they were snapshotted;
 * `delivery_fee_minor` is nullable because "no fee" and "free delivery" are
 * both real and "unknown" is not; `total_minor` is their sum and is stored
 * rather than computed on read, because it is the number the customer agreed
 * to and a formula that changes would silently rewrite history. The single
 * currency is enforced by the service (a line that prices in another currency
 * refuses the whole placement) and asserted by the architecture test.
 *
 * **No cost, margin or supplier column, by construction.** What an order cost
 * the kitchen to make is a different question asked of different tables
 * (`recipe_cost_snapshots`, which is an append-only ledger behind
 * `recipe.view_costs_organisation`). An order is what the customer was
 * charged. The architecture test asserts no column here or on `order_lines`
 * carries a cost-shaped name, so the boundary is enforced rather than
 * remembered.
 *
 * `restrictOnDelete` on the customer account and the channel: an order is a
 * financial record, and neither the party nor the route to market may be
 * removed out from under it. Customer closure (J2) is anonymisation in place,
 * which is exactly why the account cannot be deleted.
 *
 * Isolation strategy: **application scope, no PostgreSQL policy** — the same
 * decision `carts` records, and for the same reason: the row is reachable by a
 * customer who is a member of no organisation, so an organisation policy would
 * hide an order from the person who placed it. The eleven-table pin in
 * `RlsTest` is the review trigger that makes this a decision rather than an
 * omission; orders join the set when the kitchen-facing operations surface
 * arrives (F1) and the predicate can be written as "mine *or* my
 * organisation's" the way `customer_accounts`' is.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('order_number', 24)->unique()->comment('human-quotable; unique platform-wide because support answers before it knows the kitchen');

            $table->foreignUuid('organisation_id')->comment('the kitchen that sold it')->constrained('organisations')->restrictOnDelete();
            $table->foreignUuid('customer_account_id')->constrained('customer_accounts')->restrictOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->foreignUuid('branch_id')->nullable()->comment('the branch that produces it; null until one is chosen')->constrained('organisation_branches')->nullOnDelete();

            $table->string('status', 12)->default('placed')->comment('placed | confirmed | fulfilled | cancelled');
            $table->string('currency_code', 3)->comment('ISO 4217 — every amount on this order and its lines is denominated in it');

            $table->bigInteger('subtotal_minor')->comment('sum of the snapshotted lines');
            $table->bigInteger('delivery_fee_minor')->nullable()->comment('what the zone charged; null means no fee applied, never "unknown"');
            $table->bigInteger('total_minor')->comment('subtotal + fee, stored because it is what the customer agreed to');

            // The delivery address as it stood at placement. Copied, not
            // referenced: editing an address must never rewrite where an order
            // was sent.
            $table->string('delivery_label', 40)->nullable();
            $table->string('delivery_line_one');
            $table->string('delivery_line_two')->nullable();
            $table->string('delivery_city', 120)->nullable();
            $table->string('delivery_area_name_en', 120)->nullable();
            $table->string('delivery_area_name_ar', 120)->nullable();
            $table->foreignUuid('delivery_area_id')->nullable()->comment('a convenience for grouping; the snapshotted names are the record')->constrained('delivery_areas')->nullOnDelete();
            $table->foreignUuid('delivery_zone_id')->nullable()->comment('which zone priced the delivery; the fee itself is snapshotted')->constrained('delivery_zones')->nullOnDelete();

            $table->string('delivery_window_code', 40)->nullable()->comment('the slot the customer chose, as the window\'s own code');
            $table->date('requested_delivery_date')->nullable()->comment('the day the customer asked for; validated against the branch cut-off');

            $table->string('payment_method', 24)->default('cash_on_delivery')->comment('cash_on_delivery ONLY — no card, token or provider column exists on this table by design');

            $table->timestamp('placed_at');
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('fulfilled_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancellation_reason', 40)->nullable()->comment('why it was cancelled, from a fixed vocabulary');

            $table->foreignUuid('created_by')->nullable()->comment('the staff user, when an order was taken on somebody\'s behalf; null for self-service')->constrained('users')->nullOnDelete();

            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->index(['organisation_id', 'status']);
            $table->index(['customer_account_id', 'status']);
            $table->index(['organisation_id', 'requested_delivery_date']);
            $table->index('placed_at');

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('placed', 'confirmed', 'fulfilled', 'cancelled'))");

        // The single-value CHECK is the point, not a placeholder. Widening it
        // is a deliberate migration in the phase that introduces a second way
        // to pay, alongside the tables that make paying that way possible.
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method = 'cash_on_delivery')");

        // A cancelled order has a moment and a reason; an order that is not
        // cancelled has neither. Storing a reason on a live order is how a
        // cancellation that was undone leaves a ghost behind.
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_cancellation_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL) AND (cancelled_at IS NOT NULL OR cancellation_reason IS NULL))");

        // Money does not go backwards, and a total that is not the sum of its
        // parts is not a total. Both restated in the database because the
        // service computes them and a second writer would not.
        DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_amounts_check CHECK (subtotal_minor >= 0 AND (delivery_fee_minor IS NULL OR delivery_fee_minor >= 0))');
        DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_total_check CHECK (total_minor = subtotal_minor + COALESCE(delivery_fee_minor, 0))');
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
