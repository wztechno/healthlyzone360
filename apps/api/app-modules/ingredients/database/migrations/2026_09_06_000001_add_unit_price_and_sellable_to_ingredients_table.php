<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two more figures the v6 workbook records against the article: what a unit of
 * it is bought at, and whether it is offered for sale on its own.
 *
 * ## `unit_price_amount` is a purchase figure, and still not a cost
 *
 * The distinction the B2B/B2C migration drew holds here and is worth restating,
 * because this column sits closer to the line than those two did:
 *
 * - A *cost* is what one kitchen actually paid, it moves with every receipt,
 *   and it is org-specific — `ingredient_stock_costs` / `ingredient_cost_events`
 *   own it, keyed by `(organisation_id, ingredient_id)`. `RecipeCostingService`
 *   must keep reading the moving average from there and must never read this.
 * - This is the **standing list price of one stock unit**, as the operator
 *   types it into the ingredient sheet. It is the denominator the editor's
 *   margin readout divides the B2B price by, and it is a landing zone for
 *   operator entry rather than anything a receipt updates.
 *
 * It shares `price_currency_code` with the two list prices for the reason that
 * column was added with one currency in the first place: an article quoted in
 * two currencies is a price list, not a column.
 *
 * **The currency CHECK has to be replaced, not extended.**
 * `ingredients_price_currency_check` names `b2b_price_amount` and
 * `b2c_price_amount` explicitly, so a unit price with no currency would slip
 * straight past it and land in the database as a monetary value that is not a
 * monetary value. Dropping and recreating it is the only way to keep the
 * invariant true for all three amounts.
 *
 * ## `is_sellable` is its own column, and deliberately not `availability_tier`
 *
 * `availability_tier` (`core | common | specialty_imported`) is a
 * **sourcing-difficulty** axis — how hard the thing is to get hold of in the
 * launch market. It is orthogonal to whether a kitchen offers it for sale, it
 * has no member meaning "not offered", and it is NULL in all 306 seeded rows,
 * where NULL already means "sourcing unknown". Overloading it would make one
 * CHECK, one enum, one OpenAPI enum and one generated union each mean two
 * unrelated things.
 *
 * A boolean is the right shape, and there is precedent for the name and the
 * intent: `channel_catalogue_items.is_available` is described as a switch a
 * kitchen can throw without deleting the row. `is_sellable` says the same
 * thing one level up, about the article rather than about a listing of it.
 *
 * **`default(false)`, not nullable.** Two reasons. Nullable would put
 * three-valued logic into every filter and every read, for a question that has
 * only two honest answers. And the 306 seeded platform rows becoming
 * non-sellable in one statement is the correct outcome, not a regrettable one:
 * an ingredient is a raw material until somebody decides otherwise, and a
 * default of true would put the whole platform library on sale by accident.
 *
 * Note this flag deliberately sidesteps the archive guard in
 * `IngredientCatalogueService::archive()`, which refuses while a live recipe
 * version or catalogue item references the row. Turning off sale is not
 * archiving: the ingredient carries on being usable inside recipes, it simply
 * stops being offered on its own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->decimal('unit_price_amount', 18, 6)->nullable()
                ->comment('List price of one stock unit, major currency units (§4.4); not a cost and not a tariff');
            $table->boolean('is_sellable')->default(false)
                ->comment('Offered for sale as-is, outside recipes');
        });

        // A monetary value without its currency is not a monetary value (§4.4).
        // Replaced rather than added to: the original names only the two list
        // prices, so a unit price with no currency would pass it.
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_price_currency_check');
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_price_currency_check CHECK ((b2b_price_amount IS NULL AND b2c_price_amount IS NULL AND unit_price_amount IS NULL) OR price_currency_code IS NOT NULL)');

        // Zero is a legitimate list price (a giveaway, an included condiment);
        // a negative one is a data-entry accident every time.
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_price_amount_check CHECK (unit_price_amount IS NULL OR unit_price_amount >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_unit_price_amount_check');

        // Put the two-amount form back, so one step of rollback leaves the
        // currency invariant intact rather than absent.
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_price_currency_check');
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_price_currency_check CHECK ((b2b_price_amount IS NULL AND b2c_price_amount IS NULL) OR price_currency_code IS NOT NULL)');

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropColumn(['unit_price_amount', 'is_sellable']);
        });
    }
};
