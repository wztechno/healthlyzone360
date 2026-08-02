<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One thing a customer wants, and how much of it.
 *
 * **`restrictOnDelete` on the article and the variant**, matching
 * `price_list_items` and against the catalogue's usual cascade. An open basket
 * is a live commitment on the customer's side, and an article that vanished
 * out from under it would leave a cart that cannot be explained or repriced.
 * The catalogue's answer to withdrawal is `retire`, which leaves every row
 * standing — and a retired article is refused at placement, honestly, rather
 * than disappearing from the basket without a word.
 *
 * `quantity` is `decimal(12,4)` rather than an integer because the pricing
 * tiers it is matched against are decimal, and because a catalogue can sell by
 * weight. The CHECK is `> 0`: removing a line is `removeItem`, and a zero-
 * quantity row is a line nobody meant to keep.
 *
 * `delivery_date` is **part of the line's identity**, not a property of the
 * basket. A subscription-shaped order asks for the same meal on Monday and on
 * Wednesday, and those are two lines rather than a quantity of two — they are
 * cooked on different days, they hit different cut-offs, and a single line
 * could not express either. Hence the unique key below, and hence
 * `NULLS NOT DISTINCT`: a line with no date named is one line, not an
 * unlimited supply of indistinguishable ones.
 *
 * **No price column.** See `carts` — the price of a basket line is whatever
 * the price list says when somebody commits to it, and storing an advisory
 * copy here is how a stale number reaches a customer.
 *
 * Isolation strategy: **`join-rls-parent`** — reachable only through `carts`,
 * cascade-deleted with it. No policy of its own, for the reason the customer
 * child tables have none: a second policy is a second place to get the same
 * predicate wrong.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cart_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('cart_id')->constrained('carts')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->nullable()->constrained('catalogue_item_variants')->restrictOnDelete();

            $table->decimal('quantity', 12, 4);
            $table->date('delivery_date')->nullable()->comment('the day this line is wanted; part of the line identity, not a cart-wide setting');

            $table->timestamps();

            $table->index('cart_id');
        });

        DB::statement('ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_check CHECK (quantity > 0)');

        // A line is what it is, for the day it is wanted. Asking for more of
        // the same thing raises the quantity rather than adding a second row,
        // and this index is what makes `addItem` merging a guarantee instead
        // of a convention.
        DB::statement('CREATE UNIQUE INDEX cart_items_one_row_per_line ON cart_items (cart_id, catalogue_item_id, catalogue_item_variant_id, delivery_date) NULLS NOT DISTINCT');
    }

    public function down(): void
    {
        Schema::dropIfExists('cart_items');
    }
};
