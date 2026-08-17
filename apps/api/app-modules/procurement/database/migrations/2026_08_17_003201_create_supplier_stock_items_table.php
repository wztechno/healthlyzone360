<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Who sells this kitchen what (§3.3) — the link between a supplier and a shelf.
 *
 * The target is a **stock item** rather than an ingredient or a catalogue item,
 * and that is the whole reason one row can serve both books: INV2.0 derives a
 * shelf for every ingredient in the library and for every product the kitchen
 * buys in to resell, so "the thing you buy" already has exactly one identifier
 * whichever of the two it is. Linking to ingredients would have left the resold
 * products unbuyable; linking to both would have been two tables answering one
 * question.
 *
 * `stock_item_id` cascades on delete, unlike the `nullOnDelete` a goods receipt
 * uses for its supplier. **A link is current configuration, not history.** A
 * receipt that forgot what it received would be a falsified record; a link that
 * outlived the shelf it names would be a picker entry pointing at nothing. The
 * derivation never deletes a stock item in ordinary operation — a shelf follows
 * its ingredient — so this cascade fires when the ingredient itself goes, which
 * is exactly when the link stops meaning anything.
 *
 * `supplier_item_ref` is named `_ref` rather than `_code` deliberately: it is
 * the supplier's own catalogue reference, transcribed from their price list so
 * an order sheet can quote it back at them. The name also keeps it out of
 * `AuditRecorder`'s blind redaction of any metadata key containing `code`,
 * which would otherwise turn the one identifier a supplier recognises into
 * `[redacted]` in the audit trail.
 *
 * Two uniqueness rules, both in the database rather than in application care:
 *
 * - **one row per (supplier, item)** — the link is a fact about a pair, and the
 *   upsert is idempotent on it;
 * - **at most one preferred supplier per stock item**, as a partial unique
 *   index. Org-wide is correct because a supplier belongs to exactly one
 *   organisation, so `stock_item_id` alone can never collide across tenants.
 *   `SupplierItemLinkService` clears the old holder inside the same transaction
 *   before setting the new one — the index is checked per statement, so a
 *   straight handover would collide mid-swap otherwise — and this index is the
 *   backstop that stops two concurrent saves from agreeing to disagree.
 *
 * **ADR-0007 isolation: organisation column, application-scoped, no RLS.** The
 * column is carried rather than joined through `suppliers` because these rows
 * are read directly and in bulk: the supplied-items section reads them by
 * supplier, and slice 3's proposal will read them by stock item across every
 * supplier. An explicit `organisation_id` keeps `BelongsToOrganisation` honest
 * on both paths without a join. It does not join the eleven RLS-protected
 * tables and the `RlsTest` pin does not move — who sells a kitchen its flour is
 * commercial configuration, not the customer, membership and audit data phase
 * 1B chose.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_stock_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('supplier_id')->constrained('suppliers')->cascadeOnDelete();
            $table->foreignUuid('stock_item_id')->constrained('stock_items')->cascadeOnDelete();
            $table->boolean('is_preferred')->default(false);
            $table->string('supplier_item_ref', 64)->nullable()->comment("the supplier's own catalogue reference, quoted back on an order sheet");
            $table->timestamps();

            // The link is a fact about a pair, and the upsert is idempotent on it.
            $table->unique(['supplier_id', 'stock_item_id']);

            // Slice 3 reads this the other way round — every supplier of one
            // item, when the proposal picks who to order a shortage from.
            $table->index(['organisation_id', 'stock_item_id']);
        });

        // At most one preferred supplier per stock item. Org-wide is safe: a
        // supplier belongs to one organisation, so a stock item's preferred
        // link can never be claimed from outside its own tenant.
        DB::statement('CREATE UNIQUE INDEX supplier_stock_items_preferred_unique ON supplier_stock_items (stock_item_id) WHERE is_preferred');
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_stock_items');
    }
};
