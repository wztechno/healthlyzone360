<?php

declare(strict_types=1);

use Healthy360\Inventory\Services\OrderConsumptionService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `stock_items.catalogue_item_id` (INV2.0): what a stock item *is*, when the
 * thing on the shelf is a product the kitchen buys in and resells rather than an
 * ingredient it cooks with.
 *
 * A stock item is no longer hand-declared. It is derived — one per ingredient in
 * the library, one per bought-in product — and this column is the discriminator
 * that says which, so the stock screen can show a kitchen its raw goods and its
 * resale goods as two separate books without the two ever becoming two tables.
 * Three foreign keys point at `stock_items` (`stock_levels`, `stock_movements`,
 * `goods_receipt_lines`); splitting the table would have doubled all three, and a
 * nullable column costs none of that.
 *
 * `nullOnDelete`, matching `catalogue_items.ingredient_id` beside it: losing the
 * link degrades a label, and a stock row carrying a real quantity must never be
 * the reason a catalogue item cannot be archived. The row survives as an
 * ingredient-backed item, which is what it always was underneath — every stock
 * item keeps an `ingredient_id`, product-backed ones included, because the
 * moving-average cost, COGS and the monthly report are all keyed by ingredient
 * (`ingredient_stock_costs`) and a product with no ingredient would be a shelf
 * with no valuation.
 *
 * ## One product, one shelf — but several shelves may share an ingredient
 *
 * `catalogue_item_id` is uniquely indexed per organisation: derivation is the
 * only thing that ever writes a product-backed row, and a product that ended up
 * on two shelves would split one count in half. It is *partial* because the
 * column is null on every ingredient-backed row, and Postgres would otherwise
 * treat all of those as colliding with each other.
 *
 * `ingredient_id` is deliberately **not** made unique alongside it. Two shelves
 * may legitimately share one ingredient — a resold "Olive oil 500ml" and the bulk
 * olive oil a recipe divides are the same substance bought two ways — and
 * {@see OrderConsumptionService::resolveStockItem()}
 * was written for exactly that, picking the shelf that already has a level at the
 * branch. Derivation converges by checking before it inserts rather than by
 * leaning on a constraint that would outlaw a real arrangement.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_items', function (Blueprint $table): void {
            $table->foreignUuid('catalogue_item_id')
                ->nullable()
                ->after('ingredient_id')
                ->constrained('catalogue_items')
                ->nullOnDelete();
        });

        DB::statement('CREATE UNIQUE INDEX stock_items_organisation_id_catalogue_item_id_unique ON stock_items (organisation_id, catalogue_item_id) WHERE catalogue_item_id IS NOT NULL');
        DB::statement('CREATE INDEX stock_items_organisation_id_ingredient_id_index ON stock_items (organisation_id, ingredient_id) WHERE ingredient_id IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS stock_items_organisation_id_ingredient_id_index');
        DB::statement('DROP INDEX IF EXISTS stock_items_organisation_id_catalogue_item_id_unique');

        Schema::table('stock_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('catalogue_item_id');
        });
    }
};
