<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One line of an order, frozen at the moment it was placed.
 *
 * **A commercial snapshot, and only the commercial half.** `name_en`,
 * `name_ar`, `variant_label`, the quantity, the unit price, the line total and
 * the public allergen statement are copied here at placement, because all of
 * them are things the customer was shown and agreed to. A kitchen renaming a
 * dish, repricing it, or repacking it next spring must not change what an
 * order from last autumn says.
 *
 * **What is deliberately not copied**: recipe identifiers, recipe lines,
 * ingredient quantities, yields, waste coefficients, supplier identities, unit
 * costs, cost snapshots, margins. Those are the kitchen's own internals — the
 * §4.8 denylist — and an order line is the most likely thing on the platform
 * to be handed to a customer, a courier or a marketplace partner. The
 * architecture test asserts no cost-shaped column exists here, so this stays a
 * property of the schema rather than a habit of whoever writes the projection.
 *
 * `allergens` is the **public label** — allergen code and containment, nothing
 * else. Not the source ingredient, which would name a formulation; not the
 * derivation, which is an internal audit of how the label was reached. It is
 * snapshotted rather than derived on read because a customer with a nut
 * allergy who was shown "contains nuts: no" is owed the record of what they
 * were shown, even after the recipe changes.
 *
 * `pack_summary` is the same idea for the physical article: the pack size,
 * unit, piece count and net weight the customer bought, as they read on the
 * day. Nullable, because a meal is not packed.
 *
 * `price_list_id` and `price_list_item_id` record **which row said so**. They
 * carry no foreign key, deliberately: a standing price row is closed when it
 * is superseded and a whole list can be removed, and the snapshot has to
 * outlive both. A `restrictOnDelete` would freeze the tariff forever; a
 * `cascadeOnDelete` would delete the evidence. A bare identifier says "this is
 * where the number came from, if it is still there to look at".
 *
 * `restrictOnDelete` on the article and the variant, matching
 * `price_list_items` and `cart_items`: an order is the record of a sale, and
 * the thing that was sold cannot be deleted out from under it.
 *
 * Isolation strategy: **`join-rls-parent`** — reachable only through `orders`,
 * cascade-deleted with it, and carrying no policy of its own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')->constrained('catalogue_items')->restrictOnDelete();
            $table->foreignUuid('catalogue_item_variant_id')->nullable()->constrained('catalogue_item_variants')->restrictOnDelete();

            $table->string('name_en')->comment('as the customer read it on the day');
            $table->string('name_ar');
            $table->string('variant_label', 120)->nullable()->comment('the pack or configuration, as it was labelled');

            $table->decimal('quantity', 12, 4);
            $table->bigInteger('unit_price_minor')->comment('what one unit cost the customer; never what it cost the kitchen');
            $table->bigInteger('line_total_minor');
            $table->string('currency_code', 3)->comment('ISO 4217 — always the order\'s own; restated so no amount travels without one');

            $table->jsonb('allergens')->default(DB::raw("'[]'::jsonb"))->comment('the PUBLIC label only: [{allergen_code, containment}] — never a source ingredient or a formulation');
            $table->jsonb('pack_summary')->nullable()->comment('pack size, unit, piece count, net weight as the customer bought it');

            $table->uuid('price_list_id')->nullable()->comment('which tariff priced it; no FK, because the snapshot must outlive the tariff');
            $table->uuid('price_list_item_id')->nullable()->comment('which row said so; no FK, for the same reason');

            $table->timestamps();

            $table->index('order_id');
            $table->index('catalogue_item_id');

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE order_lines ADD CONSTRAINT order_lines_quantity_check CHECK (quantity > 0)');
        DB::statement('ALTER TABLE order_lines ADD CONSTRAINT order_lines_amounts_check CHECK (unit_price_minor >= 0 AND line_total_minor >= 0)');

        // An article appears once on an order; asking for more of it is a
        // quantity. NULLS NOT DISTINCT so the variant-less shape is one line
        // rather than an unlimited number of indistinguishable ones.
        DB::statement('CREATE UNIQUE INDEX order_lines_one_row_per_article ON order_lines (order_id, catalogue_item_id, catalogue_item_variant_id) NULLS NOT DISTINCT');
    }

    public function down(): void
    {
        Schema::dropIfExists('order_lines');
    }
};
