<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How an order leaves the kitchen — and the two columns that stop being
 * compulsory because of it.
 *
 * `2026_08_04_001401_create_orders_table` was written for one way of selling:
 * somebody with a login fills a basket, names an address, and a driver takes
 * the food to it. Every column on that table encodes the assumption —
 * `customer_account_id` NOT NULL because there was always an account,
 * `delivery_line_one` NOT NULL because there was always a door. The Order Desk
 * sells two other ways, and neither of them is that.
 *
 * ## What each arm means to somebody standing at the desk
 *
 *  * **`delivery`** — the order the platform has always taken. A customer, an
 *    address, a courier. Both columns are still required, and the shape CHECK
 *    below says so rather than the column definitions, which is the only change
 *    to this arm: what was structural is now conditional.
 *  * **`pickup`** — the customer is coming to fetch it. There is still an
 *    account (somebody has to be rung when it is ready, and somebody has to be
 *    handed the bag) and there is still a **promised slot** — `delivery_window_
 *    code` and `requested_delivery_date` mean exactly what they meant before,
 *    because "be here at six" is a promise whether the food travels or not.
 *    What there is not is a **destination**. A pickup order with an address
 *    snapshot on it would be a courier instruction nobody will follow.
 *  * **`counter`** — somebody walked in and bought lunch. There may be a
 *    customer: a regular is worth naming, and naming them is what makes their
 *    order history and their allergen profile reachable. There is never an
 *    address. The asymmetry is the whole reason `counter` is its own arm rather
 *    than "pickup without an account" — the desk **may know who** and must
 *    **never claim where**.
 *
 * The shape CHECK states those three sentences as one constraint, and it is a
 * constraint rather than a service rule because the columns it governs are
 * written by the placement service today and will be written by a counter-sale
 * path, an importer and a backfill before this table is old. A rule enforced in
 * one writer is a rule the second writer does not know about.
 *
 * ## `fulfilment_type` is NOT NULL with a default, and the default is the backfill
 *
 * Every order already on this platform is a delivery, so `DEFAULT 'delivery'`
 * populates the existing rows as the column is added and no separate UPDATE
 * runs. The default is then kept rather than dropped: `OrderPlacementService`
 * does not name a fulfilment type, so the delivery path keeps working
 * unchanged, and the day a writer forgets to name one the row it produces is
 * the conservative kind — an order somebody has to take somewhere — rather than
 * a counter sale nobody will deliver.
 *
 * ## `placed_on_behalf_by` is not `created_by`, and `created_by`'s own comment is wrong
 *
 * `orders.created_by` carries the comment *"the staff user, when an order was
 * taken on somebody's behalf; null for self-service"*. That is not what it
 * holds. `OrderPlacementService::persist()` writes `$this->context->userId()`
 * on **every** path — a customer placing their own order writes their own user
 * id there — so the column is "who transacted this placement", which is a
 * useful and different fact. It is left alone here: rewriting a column's
 * meaning to make room for a new one is how the meaning of the old rows becomes
 * unknowable.
 *
 * So provenance gets its own column. `placed_on_behalf_by` is non-null on
 * exactly the orders a member of staff placed **for** somebody else, and null
 * on every self-service order, which makes "did a human at a desk take this
 * order" answerable with `IS NOT NULL` rather than with a join against the
 * memberships table to see whether `created_by` happened to be an employee.
 *
 * `nullOnDelete` rather than `restrictOnDelete`, unlike `order_payment_
 * receipts.confirmed_by`: a receipt is an *assertion* whose asserter must stay
 * named or the claim becomes anonymous, whereas this is *provenance*. An order
 * placed by an employee who has since left the company is still an order; the
 * useful residue is that it exists, and losing the name to a staff deletion
 * costs less than making a leaver undeletable.
 *
 * ## The address snapshot gets wider, because a courier needs more than a street
 *
 * `customer_addresses` has held `building`, `floor`, `apartment` and
 * `directions` since it was created, and `contact_point_id` — "the number the
 * courier calls" — beside them. None of it reached the order. So the snapshot
 * this table takes at placement has been a strictly poorer copy than the row it
 * was copied from: an order could be delivered to "Rue Gouraud 12" with the
 * fourth-floor, second-door, *ring the bell twice* part left behind in a table
 * the customer is free to edit.
 *
 * A snapshot exists to record **where the order actually went**, and that is
 * the argument for widening it rather than joining. The address row may be
 * edited, moved or deleted; the delivery that already happened may not be
 * rewritten by any of that. The courier surface C3 builds reads these columns.
 *
 * `delivery_contact_point_id` is a reference and not a copied number, matching
 * `customer_addresses.contact_point_id` and for the same reason — a person who
 * changes their telephone changes it once, and the verification state travels
 * with the row. `nullOnDelete`, so a contact point being withdrawn does not
 * hold an order hostage. It records **which number the courier was given**,
 * which is a different question from "what is this customer's number today"
 * and is the one worth being able to answer after the fact.
 *
 * ## Why the two NOT NULLs come off, and what replaces them
 *
 * `customer_account_id` and `delivery_line_one` stop being column-level
 * requirements and become arms of the shape CHECK. Nothing is relaxed: a
 * delivery order still cannot exist without either of them. What changes is
 * that the requirement is now stated **per fulfilment type**, which is the only
 * place it was ever true.
 *
 * The foreign key and its `restrictOnDelete` stay exactly as they were. A
 * nullable reference is still a reference: when an order names a customer
 * account, that account may not be deleted out from under it — J2's closure is
 * anonymisation in place precisely because the row has to survive — and when it
 * names none there is nothing to restrict.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->string('fulfilment_type', 12)
                ->default('delivery')
                ->comment('delivery | pickup | counter — how the food reaches whoever bought it; the default is also the backfill for every row placed before this column existed');

            $table->foreignUuid('placed_on_behalf_by')
                ->nullable()
                ->comment('the member of staff who took this order FOR somebody else; null on every self-service order. Deliberately not created_by, which is written on every path including self-service and whose own comment is wrong about that')
                ->constrained('users')
                ->nullOnDelete();

            // The rest of the address, mirrored from `customer_addresses` at
            // placement. Same widths as the source columns, so a snapshot can
            // never be a truncation of the row it copied.
            $table->string('delivery_building', 120)->nullable();
            $table->string('delivery_floor', 40)->nullable();
            $table->string('delivery_apartment', 40)->nullable();
            $table->text('delivery_directions')->nullable()->comment('free text for the courier; never parsed, never matched against');
            $table->foreignUuid('delivery_contact_point_id')
                ->nullable()
                ->comment('the number the courier was actually given, as a reference rather than a copy; a snapshot of which contact was named at placement, not of what it said')
                ->constrained('contact_points')
                ->nullOnDelete();
        });

        // Raw `ALTER COLUMN` rather than a Blueprint `->change()`: `change()`
        // restates the whole column definition, and restating one that carries
        // a foreign key is how a `restrictOnDelete` quietly becomes a
        // `NO ACTION`. Dropping the null constraint on its own touches nothing
        // else about either column.
        DB::statement('ALTER TABLE orders ALTER COLUMN customer_account_id DROP NOT NULL');
        DB::statement('ALTER TABLE orders ALTER COLUMN delivery_line_one DROP NOT NULL');

        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_fulfilment_type_check CHECK (fulfilment_type IN ('delivery', 'pickup', 'counter'))");

        // The three sentences from the docblock, as one constraint. Written as
        // an explicit disjunction rather than a CASE so that each arm reads as
        // the rule it is, and total because `fulfilment_type` is NOT NULL and
        // already constrained to exactly these three values.
        //
        // Note what the `counter` arm does NOT say: it makes no claim about
        // `customer_account_id`. A walk-in may be a stranger or may be a
        // regular the desk names, and both are ordinary. What it may never be
        // is an order with a delivery address, because nobody is delivering it.
        DB::statement(<<<'SQL'
            ALTER TABLE orders ADD CONSTRAINT orders_fulfilment_shape_check CHECK (
                (fulfilment_type = 'delivery' AND customer_account_id IS NOT NULL AND delivery_line_one IS NOT NULL)
                OR (fulfilment_type = 'pickup' AND customer_account_id IS NOT NULL AND delivery_line_one IS NULL)
                OR (fulfilment_type = 'counter' AND delivery_line_one IS NULL)
            )
        SQL);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_fulfilment_shape_check');
        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_fulfilment_type_check');

        Schema::table('orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('delivery_contact_point_id');
            $table->dropConstrainedForeignId('placed_on_behalf_by');
            $table->dropColumn([
                'fulfilment_type',
                'delivery_building',
                'delivery_floor',
                'delivery_apartment',
                'delivery_directions',
            ]);
        });

        // Restoring the two NOT NULLs is legal only where nobody has yet sold
        // across a counter, exactly as the payment migration's `down()` is
        // legal only where nobody has paid another way: PostgreSQL validates
        // the constraint against the rows already there, so this refuses rather
        // than silently deleting a counter sale or inventing an address for it.
        // That refusal is the correct behaviour.
        DB::statement('ALTER TABLE orders ALTER COLUMN customer_account_id SET NOT NULL');
        DB::statement('ALTER TABLE orders ALTER COLUMN delivery_line_one SET NOT NULL');
    }
};
