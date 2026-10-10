<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How a sellable the kitchen **made in advance** leaves the shelf (PROD1).
 *
 * Two kinds of sale already exist and the catalogue distinguishes them by type
 * alone: a meal is cooked when ordered, so selling one explodes its recipe and
 * takes the raw materials then; a sauce or dressing was cooked earlier, so
 * selling one draws a unit off the shelf its `ingredient_id` names and exploding
 * it would take that mayonnaise a second time.
 *
 * Frozen meals, prepared salads and batch-cooked mains are the second kind and
 * were being described by the first. `frozen_meal` joins the type list for the
 * ones that are plainly their own family, and `sells_from_finished_stock` covers
 * the rest — a prepared salad is still a meal, and giving every production style
 * its own enum member would grow the type column one case at a time while leaving
 * the actual question (was this made in advance?) implicit.
 *
 * ## The flag defaults false, and that is the whole safety story
 *
 * Every existing meal keeps exploding its recipe on the deploy that adds this.
 * Nothing moves by a gram until somebody sets the flag, and setting it is refused
 * unless the item is one the kitchen actually produces (`production_mode` of
 * `production` or `both`) **and** names an ingredient a published recipe version
 * outputs — the service enforces both, because a flag set on an item with no
 * finished goods behind it would deduct from a shelf that does not exist.
 *
 * ## Net content, because `portion_factor` cannot carry it
 *
 * `portion_factor` is dimensionless — *how much of a yield piece the sold article
 * is* — so it says nothing about how much of a shelf one sold unit takes when
 * that shelf is counted in kilograms. A 350 g tray against a kilogram shelf needs
 * `0.35`, and `portion_factor` has no way to express that without being read as
 * "350 pieces".
 *
 * So one sold unit states how much of the produced ingredient it *is*:
 * `net_content_quantity` in `net_content_unit_id`, converted into the shelf's own
 * unit at deduction time. Null is legal and common — a frozen meal counted in
 * pieces is one piece — and the consumption path falls back to `portion_factor`
 * only where the shelf is a count. Against a mass or volume shelf with no net
 * content declared it **refuses** rather than guessing, because a guess there is
 * wrong by three orders of magnitude.
 *
 * Isolation strategy: unchanged — these are columns on `catalogue_items`, which
 * already carries its own scoping.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_item_type_check');
        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_item_type_check CHECK (item_type IN ('product', 'meal', 'subscription_plan', 'sauce', 'dressing', 'frozen_meal'))");

        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->boolean('sells_from_finished_stock')
                ->default(false)
                ->after('production_mode')
                ->comment('made in advance: selling one draws finished stock instead of exploding the recipe');

            $table->decimal('net_content_quantity', 12, 4)
                ->nullable()
                ->after('portion_factor')
                ->comment('how much of the produced ingredient one sold unit is');

            $table->foreignUuid('net_content_unit_id')
                ->nullable()
                ->after('net_content_quantity')
                ->comment('the unit net_content_quantity is stated in')
                ->constrained('measurement_units')
                ->restrictOnDelete();
        });

        DB::statement('ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_net_content_check CHECK ((net_content_quantity IS NULL AND net_content_unit_id IS NULL) OR (net_content_quantity > 0 AND net_content_unit_id IS NOT NULL))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE catalogue_items DROP CONSTRAINT IF EXISTS catalogue_items_net_content_check');

        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('net_content_unit_id');
            $table->dropColumn(['sells_from_finished_stock', 'net_content_quantity']);
        });

        DB::statement('ALTER TABLE catalogue_items DROP CONSTRAINT catalogue_items_item_type_check');
        DB::statement("ALTER TABLE catalogue_items ADD CONSTRAINT catalogue_items_item_type_check CHECK (item_type IN ('product', 'meal', 'subscription_plan', 'sauce', 'dressing'))");
    }
};
