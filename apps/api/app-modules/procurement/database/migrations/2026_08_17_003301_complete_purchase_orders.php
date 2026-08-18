<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The purchase order becomes a document (§3.5).
 *
 * `purchase_orders` has existed since the first procurement migration as four
 * columns — organisation, supplier, a `status` string with no CHECK behind it,
 * timestamps — because a goods receipt needed something to point at. Nothing has
 * ever written a row. This is the slice that makes it the request a kitchen
 * hands a supplier: which branch is asking, the number both sides quote at each
 * other, when it was issued and to whom exactly it was addressed at that moment.
 *
 * ## Safe, even though this database holds nothing
 *
 * §2 is explicit that schema safety must not rest on the development database
 * happening to be empty, so the order here is the order a populated table would
 * need: **add nullable, decide about the rows, then constrain.**
 *
 * The decision is to **stop**, not to backfill, and the reason is `branch_id`.
 * A number can be minted for a row that has none — it is an identifier, and any
 * unique string is as true as any other. A *branch* cannot: it is a fact about
 * where the goods were wanted, it is not recoverable from anything else on the
 * row, and inventing one would put a delivery expectation on a site that never
 * asked for it. One guard rather than two, because a migration that backfilled
 * half the required columns and then refused would leave an operator reading
 * two error messages to learn one thing.
 *
 * The guard throws mid-migration and that is safe: PostgreSQL has transactional
 * DDL and Laravel runs each migration inside a transaction when the grammar
 * supports it, so nothing added above survives the throw. The message names the
 * table, the count and the two columns, because the person reading it at deploy
 * time is the person who has to decide what those rows meant.
 *
 * ## `supplier_id` flips from CASCADE to RESTRICT
 *
 * The original table let a deleted supplier take its orders with it. That was
 * harmless while the table was a stub and is not now: an issued purchase order
 * is a commitment the kitchen made, and SUP1 already established that suppliers
 * **archive** rather than delete precisely so their history survives. RESTRICT
 * is that rule expressed where it cannot be forgotten — the database refuses the
 * delete rather than quietly erasing the order book alongside it.
 *
 * ## All five statuses now, two of them not yet reachable
 *
 * The CHECK admits `partially_received` and `received` even though nothing in
 * this slice can produce them: slice 5's receipts are what drive those
 * transitions, and shipping the constraint now means that slice changes the
 * `PurchaseOrderStatus` enum and nothing else. A CHECK widened later is a
 * migration; an enum widened later is a comment.
 *
 * The two stamp CHECKs are the same idea from the other side. An `issued` order
 * without `issued_at` is a document nobody can date, and a `cancelled` one
 * without `cancelled_at` is the same hole. `cancelled` is deliberately exempt
 * from the issued-stamp rule: a draft cancelled before it was ever issued has no
 * issue date and should not pretend to one, while an issued order that is later
 * cancelled **keeps** its `issued_at` — cancelling does not un-issue.
 *
 * ## ADR-0007 isolation: organisation column, application-scoped, no RLS
 *
 * Unchanged from the stub, and now load-bearing rather than incidental. Purchase
 * orders are read directly and in bulk — the order book lists them by status, by
 * supplier and by identifier set — so the column is carried rather than joined
 * through `suppliers`, and `UNIQUE(organisation_id, number)` is only expressible
 * with it present. The table does not join the eleven RLS-protected tables and
 * the `RlsTest` pin does not move: what a kitchen is about to buy is commercial
 * configuration, not the customer, membership and audit data phase 1B chose.
 */
return new class extends Migration
{
    public function up(): void
    {
        // (a) Nullable first. Every column an existing row could not answer
        // arrives without a constraint, so the table is never briefly in a
        // state a populated database could not reach.
        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->foreignUuid('branch_id')->nullable()->after('organisation_id');
            $table->string('number', 32)->nullable()->after('supplier_id')->comment('the human identifier both sides quote — PO- plus 8 Crockford base-32 characters');
            $table->timestamp('issued_at')->nullable()->after('status');
            $table->timestamp('received_at')->nullable()->after('issued_at')->comment('when the last outstanding line was fulfilled (slice 5)');
            $table->timestamp('closed_at')->nullable()->after('received_at')->comment('when a short delivery was closed with a reason (slice 5)');
            $table->timestamp('cancelled_at')->nullable()->after('closed_at');
            $table->text('notes')->nullable()->after('cancelled_at');
            $table->jsonb('recipient_snapshot')->nullable()->after('notes')->comment('who this was addressed to at the instant of issue, for stable reprints (§3.5)');
        });

        // (b) The deploy-time invariant. See the class docblock: a branch cannot
        // be invented, so a table that already holds orders needs a human.
        $existing = DB::table('purchase_orders')->whereNull('branch_id')->count();

        if ($existing > 0) {
            throw new RuntimeException(
                "purchase_orders holds {$existing} row(s) predating branch_id and number. ".
                'Both are required from this migration onward and neither can be derived: a branch is where the goods were wanted, '.
                'and no other column records it. Set branch_id and number on those rows (or delete them if they were never real orders) and re-run.'
            );
        }

        // (c) Only now the constraints. Raw `ALTER COLUMN` rather than a
        // Blueprint `->change()` for the same reason the orders migration gives:
        // `change()` restates the whole column definition, which silently drops
        // the comments added above. Setting the null constraint on its own
        // touches nothing else about either column.
        DB::statement('ALTER TABLE purchase_orders ALTER COLUMN branch_id SET NOT NULL');
        DB::statement('ALTER TABLE purchase_orders ALTER COLUMN number SET NOT NULL');

        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->foreign('branch_id')->references('id')->on('organisation_branches')->cascadeOnDelete();

            // The arbiter of the number mint. `PurchaseOrderNumbers` proposes and
            // this index disposes: a collision is a 23505 the service unwinds to
            // a savepoint and re-mints against, never a read-then-write race.
            $table->unique(['organisation_id', 'number']);

            // The order book's two reads: "what is still open" and "everything we
            // have ever asked this supplier for".
            $table->index(['organisation_id', 'status']);
            $table->index(['organisation_id', 'supplier_id']);
        });

        // All five now — slice 5 reaches the last two without touching this file.
        DB::statement("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('draft', 'issued', 'partially_received', 'received', 'cancelled'))");

        // A document that has left the building has a date on it. `cancelled` is
        // exempt because a draft may be cancelled before it was ever issued.
        DB::statement("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_issued_stamp_check CHECK (status NOT IN ('issued', 'partially_received', 'received') OR issued_at IS NOT NULL)");
        DB::statement("ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_cancelled_stamp_check CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)");

        // (d) A supplier archives; it never deletes out from under an order.
        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->dropForeign(['supplier_id']);
            $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete();
        });
    }

    /**
     * Back to the stub, exactly — the four columns and the CASCADE the first
     * procurement migration created, so a rollback past this point leaves the
     * table the earlier migration's own `down()` expects to drop.
     */
    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->dropForeign(['supplier_id']);
            $table->foreign('supplier_id')->references('id')->on('suppliers')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_cancelled_stamp_check');
        DB::statement('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_issued_stamp_check');
        DB::statement('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check');

        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'supplier_id']);
            $table->dropIndex(['organisation_id', 'status']);
            $table->dropUnique(['organisation_id', 'number']);
            $table->dropConstrainedForeignId('branch_id');
            $table->dropColumn([
                'number',
                'issued_at',
                'received_at',
                'closed_at',
                'cancelled_at',
                'notes',
                'recipient_snapshot',
            ]);
        });
    }
};
