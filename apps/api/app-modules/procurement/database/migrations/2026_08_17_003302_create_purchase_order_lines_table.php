<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What the kitchen is actually asking for (§3.5) — one row per shelf on one
 * purchase order.
 *
 * ## There is no money here, and there never will be
 *
 * Not a `unit_price`, not a `line_total`, not a `currency_code`. A purchase
 * order is the **request**; a goods receipt is the **delivery and the invoice**,
 * and §3.5 keeps the two apart because they genuinely disagree in practice — two
 * partial deliveries against one order legitimately arrive at two different
 * prices, and a price copied onto the order at issue time would be a figure
 * nobody ever paid. A cost-authorised screen may show the last *historical*
 * receipt price beside a line as a reference; it is never written here and never
 * printed. A structural test pins the absence, because the way this rule breaks
 * is somebody adding a helpful column.
 *
 * ## Everything display-facing is snapshotted, and the server is what fills it
 *
 * `item_code`, `item_name_en`, `item_name_ar` and `unit_code` are copies taken
 * at write time from the stock item, never accepted from the client. Two reasons,
 * and both matter:
 *
 * - **Issued orders are immutable.** A shelf renamed in March must not silently
 *   rename the line on an order issued in February, because the supplier is
 *   holding a printed copy of the February wording.
 * - **A client-supplied label is a client-supplied lie.** §6 says the batch
 *   create never trusts a client unit or item name, so the columns exist to hold
 *   what the server resolved rather than what the request claimed.
 *
 * `item_name_ar` is nullable and the other three are not, because Arabic is the
 * one that can genuinely be absent: `stock_items` carry `name_en` only, so the
 * Arabic name is resolved from the backing ingredient or catalogue item and a
 * shelf backed by neither has none. A blank is honest there; an English name in
 * the Arabic column would be a mistranslation printed on a document.
 *
 * `unit_id` is nullable while `unit_code` is not, and that asymmetry is the
 * truth about `stock_items`: every shelf carries a `unit_code` string, not every
 * shelf has its `unit_id` resolved to a `measurement_units` row yet (INV1.0 left
 * that half-finished). The code is what prints; the id is what a later
 * conversion would need.
 *
 * ## `stock_item_id` RESTRICTs where the supplier link CASCADEs
 *
 * The exact opposite of `supplier_stock_items`, and deliberately so. That table
 * is **current configuration**: a link that outlived the shelf it names would be
 * a picker entry pointing at nothing, so it goes when the shelf goes. This table
 * is a **record**: an order line that vanished because somebody tidied up the
 * ingredient library would leave a purchase order whose printed copy has more
 * lines on it than the database does. A record that can quietly lose rows is not
 * a record, so the database refuses the delete instead.
 *
 * ## ADR-0007 isolation: no organisation column — join-parent, application-scoped
 *
 * A line is never read on its own. Every query for one starts from its purchase
 * order — the detail screen, the print batch, slice 5's receipt matching — and
 * the order carries the explicit `organisation_id`, so scoping through the
 * parent is both sufficient and unavoidable. The same choice `goods_receipt_lines`
 * made for the same reason, and the opposite of `supplier_stock_items`, which is
 * read directly and in bulk by stock item and therefore carries its own column.
 * Services must scope through the parent; nothing here may be read by line id
 * alone. No RLS and the `RlsTest` pin does not move.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_order_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();

            // A record, not configuration — see the class docblock.
            $table->foreignUuid('stock_item_id')->constrained('stock_items')->restrictOnDelete();

            $table->decimal('quantity', 14, 4)->comment('stock precision, matching stock_levels.quantity');

            $table->foreignUuid('unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();
            $table->string('unit_code', 16)->comment('snapshotted from the stock item — what prints on the order sheet');

            $table->string('item_code', 64)->comment('snapshotted; the kitchen\'s own identifier for the shelf');
            $table->string('item_name_en', 160)->comment('snapshotted');
            $table->string('item_name_ar', 160)->nullable()->comment('snapshotted from the backing ingredient or catalogue item; null when neither has one');

            // `_ref` rather than `_code`, for the reason `supplier_stock_items`
            // records: it is the supplier's own catalogue reference, and the name
            // also keeps it out of AuditRecorder's blind redaction of any
            // metadata key containing `code`.
            $table->string('supplier_item_ref', 64)->nullable()->comment("the supplier's own reference, quoted back at them");
            $table->string('notes', 255)->nullable();

            $table->unsignedSmallInteger('display_order')->default(0);
            $table->timestamps();

            // One line per shelf per order. Ordering the same thing twice on one
            // sheet is a mistake a supplier would have to phone about, and the
            // batch create merges nothing silently — it refuses.
            $table->unique(['purchase_order_id', 'stock_item_id']);

            // The read: every line of one order, in the sequence the person
            // building it chose.
            $table->index(['purchase_order_id', 'display_order']);
        });

        // Nothing is ordered by asking for none of it. Zero is how a builder row
        // says "leave this one out", and it is excluded before it ever reaches
        // here; a zero that arrived anyway is a bug, not a line.
        DB::statement('ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_quantity_check CHECK (quantity > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_order_lines');
    }
};
