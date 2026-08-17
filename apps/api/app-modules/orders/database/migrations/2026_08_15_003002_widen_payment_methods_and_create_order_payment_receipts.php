<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two more ways to pay, and the table that makes paying that way possible.
 *
 * `2026_08_04_001401_create_orders_table` gave `orders.payment_method` a CHECK
 * that admitted exactly one value, and stated the terms on which it could ever
 * be widened: *"The single-value CHECK is the point, not a placeholder.
 * Widening it is a deliberate migration in the phase that introduces a second
 * way to pay, alongside the tables that make paying that way possible."*
 *
 * **This is that migration.** The Order Desk sells to somebody standing at a
 * counter and to somebody on the telephone, and neither of them is paying cash
 * to a driver at a door. `cash_at_counter` is money handed over in the room;
 * `wish` is a transfer through the WISH app. And `order_payment_receipts` is
 * "the tables that make paying that way possible" — because a payment method
 * that records nothing beyond its own name is a label, not a way to pay.
 *
 * ## WISH is an assertion, and `confirmed_by` is the whole control
 *
 * There is no WISH integration. Nothing in this schema talks to a provider,
 * verifies a transfer, or reconciles a settlement, and nothing here pretends
 * otherwise: a desk person looks at the merchant app, sees that the money
 * arrived, and **says so**. `confirmed_by` is that person, by name and by
 * foreign key, and it is `restrictOnDelete` for the same reason the order's
 * customer is — an assertion whose asserter can be deleted is an anonymous
 * claim, which is the one thing this row must never become. `reference` is the
 * transaction identifier they typed off the screen; it is nullable because
 * cash has no such thing, and free text because it is somebody else's
 * vocabulary.
 *
 * The integration, when it arrives, **verifies against these same rows**. It
 * needs a verification timestamp and a provider column beside the reference
 * already here — not a second ledger, and not a re-modelling of what the desk
 * recorded. Building the manual ledger first is what makes the automated one
 * a reconciliation rather than a migration.
 *
 * ## "Paid" is derived, and there is no payment-status column
 *
 * An order is receipted when `SUM(amount_minor) >= orders.total_minor` over
 * its receipts. That predicate is computed on read and **stored nowhere**.
 * There is no `payment_status` on `orders`, there is none here, and there will
 * not be one: it is precisely the shape `OrderArchitectureTest` forbids by
 * substring on the orders table, and a stored flag beside an append-only
 * ledger is a second answer to a question the ledger already answers. Two
 * answers drift — the first time a receipt is written by anything other than
 * the one endpoint that also maintains the flag, the flag is wrong and nothing
 * says so.
 *
 * The predicate is an inequality in both directions on purpose. A part payment
 * is real (a deposit now, the balance on delivery) and so is an over-payment
 * (a customer hands over a round note and is given change from the till, not
 * from this table), so several receipts may hang off one order and their sum
 * may exceed its total. Neither is an error state and neither is constrained
 * against.
 *
 * ## Coexistence: an order carries intents or receipts, never both
 *
 * `payment_intents` is **live**, not dormant: `POST /payments/intents` writes
 * rows today, `unique(order_id)` means an order has at most one, and the
 * capture and refund routes read it. This table does not replace it and does
 * not touch it — the payments module is untouched by this migration.
 *
 * The two never meet, by construction rather than by constraint. A desk order
 * never creates an intent: the desk takes the money in the room and records
 * what it took, so there is no code path from a counter sale to
 * `PaymentService`. Enforcing that with a cross-table exclusion would mean a
 * trigger or a deferred check spanning two modules' schemas — coupling Orders
 * to Payments in the database for the first time, to forbid a thing no writer
 * does.
 *
 * ## Append-only by convention, and deliberately **not** a revoked ledger
 *
 * There is no update route and no delete route for a receipt, and there will
 * not be. Money arriving is not an event that un-happens; the amount CHECK
 * refuses a negative figure because giving money back is a different act, with
 * a different authority, in the refunds table that already exists for it.
 *
 * What this table deliberately does **not** get is the `append-only-ledger`
 * treatment — the `REVOKE UPDATE, DELETE` that `audit_logs`,
 * `recipe_cost_snapshots` and `stock_movements` carry and that `RlsTest` pins
 * at exactly three. The pin exists so that a fourth ledger has to be argued
 * for, and the argument does not carry here. Those three are evidence *about*
 * the system which the system itself must not be able to rewrite: an audit
 * trail, a cost history, the movement record behind every COGS figure. A desk
 * receipt is an operational record with one writer, no reader outside the
 * kitchen that wrote it, and a correction path that is a manager and a phone
 * call rather than an UPDATE. Convention is the honest strength of the
 * guarantee, so convention is what is claimed.
 *
 * ## No row-level-security policy, matching `orders` itself
 *
 * Isolation strategy: **`org-rls` in vocabulary, application scope in
 * mechanism** — the decision `orders` and `carts` both record, and a receipt
 * has less claim to a policy than either. It is reachable only through an
 * order; `OrderQuery::forSeller()` is the only kitchen-facing way to an order
 * and it never forgets its filter; and unlike an order there is no
 * customer-facing read path here at all. A policy on the child of an
 * unprotected parent protects nothing that resolving the parent has not
 * already decided. The eleven-table `rowsecurity` pin in `RlsTest` is the
 * review trigger that makes this a decision rather than an omission, and it
 * stays at eleven across this migration.
 *
 * ## Money, and the shape of the amount
 *
 * Commerce side, so commerce style: `bigInteger` minor units beside a
 * `string(3) currency_code` with a `restrictOnDelete` foreign key to
 * `currencies.code` — the idiom `orders` uses for its own three amounts, kept
 * identical so that a receipt and the order it pays for are summable without a
 * conversion. There is deliberately no currency *validation* against the
 * order's own here: the endpoint that writes these rows takes the currency
 * from the order rather than from the request, so a mismatch is unreachable
 * without a second writer, and a CHECK spanning two tables is not a CHECK.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check');
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('cash_on_delivery', 'cash_at_counter', 'wish'))");

        Schema::create('order_payment_receipts', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('organisation_id')->comment('the kitchen that was paid')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('order_id')->comment('what was paid for; restricted because a receipt is a financial record of that order')->constrained('orders')->restrictOnDelete();

            $table->string('method', 24)->comment('cash_on_delivery | cash_at_counter | wish — the same vocabulary the order states its intent in, and deliberately not constrained to match it');
            $table->bigInteger('amount_minor')->comment('what arrived, in minor units of currency_code');
            $table->string('currency_code', 3)->comment('ISO 4217 — taken from the order, never from the request');

            $table->string('reference', 120)->nullable()->comment('the WISH transaction id the desk typed in; null for cash');
            $table->foreignUuid('confirmed_by')->comment('who says the money arrived — the accountable assertion')->constrained('users')->restrictOnDelete();
            $table->timestampTz('confirmed_at')->comment('when they say it arrived, which is not always when they wrote it down');
            $table->string('notes', 300)->nullable();

            $table->timestamps();

            $table->index(['organisation_id', 'confirmed_at']);
            $table->index('order_id');

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        // The same three values the order's own CHECK now admits. Restated here
        // rather than inherited, because a receipt records how the money
        // *actually* arrived and the order records what was intended — an order
        // placed for cash at the counter and settled by WISH is a real evening,
        // and the pair of columns is how it stays legible.
        DB::statement("ALTER TABLE order_payment_receipts ADD CONSTRAINT order_payment_receipts_method_check CHECK (method IN ('cash_on_delivery', 'cash_at_counter', 'wish'))");

        // Zero is legal and negative is not. A zero-amount receipt is somebody
        // recording that a nil balance was settled, which is harmless; a
        // negative one is a refund wearing a receipt's clothes, and refunds are
        // the payments module's table and the payments module's authority.
        DB::statement('ALTER TABLE order_payment_receipts ADD CONSTRAINT order_payment_receipts_amount_check CHECK (amount_minor >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('order_payment_receipts');

        // Narrowing back is legal only where nobody has yet paid another way:
        // PostgreSQL validates an added CHECK against the rows already there,
        // so this refuses rather than silently discarding the record of a
        // counter sale. That refusal is the correct behaviour — a way of paying
        // that has been used is not a schema decision that can be reversed.
        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check');
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method = 'cash_on_delivery')");
    }
};
