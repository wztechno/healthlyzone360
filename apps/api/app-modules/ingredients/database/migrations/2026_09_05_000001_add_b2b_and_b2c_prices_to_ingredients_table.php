<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The two list prices an ingredient is offered at: `b2b_price_amount` to a
 * kitchen or corporate buyer, `b2c_price_amount` to a diner.
 *
 * **These are list prices on the article, not costs, and not a price list.**
 * The distinction is the whole reason they can live here at all:
 *
 * - A *cost* is what one kitchen paid, it moves with every receipt, and it is
 *   org-specific — so it stays in `ingredient_stock_costs` /
 *   `ingredient_cost_events`, keyed by `(organisation_id, ingredient_id)`.
 *   Nothing in this migration touches that path, and `RecipeCostingService`
 *   must keep reading the moving average, never these columns.
 * - A *channel tariff* — the amount a specific price list charges a specific
 *   segment on a specific date — stays in `price_lists` / `price_list_items`.
 *
 * What is left, and what these two columns are, is the standing figure the v6
 * workbook records against the article itself.
 *
 * **A platform row's price is one price for everybody.** `ingredients` with
 * `organisation_id` NULL is the shared library every tenant reads, so a price
 * written there is visible to all of them; a kitchen that needs its own
 * figure forks the row (`forked_from_ingredient_id`) or prices it in a price
 * list. This is a narrower claim than the cost tables' "the platform table
 * stays cost-free", and deliberately so — it is the same claim
 * `catalogue_items` makes about published content.
 *
 * `decimal(18, 6)` in **major** currency units, matching every other monetary
 * column in the schema (master plan v2 §4.4) — never minor units, never a
 * float. `price_currency_code` is one currency for both amounts: a single
 * article quoted in two different currencies is a price list, not a column.
 * The CHECK mirrors `ingredient_stock_costs`: a monetary value without its
 * currency is not a monetary value.
 *
 * The v6 workbook's sheet 1 carries no price at all — its `Price` column is
 * empty in all 306 rows, and the B2B/B2C figures live on the sellable sheets
 * that become `catalogue_items`. So every seeded row starts NULL here, and
 * this is a landing zone for operator entry rather than a column anyone can
 * backfill from the source.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->decimal('b2b_price_amount', 18, 6)->nullable()
                ->comment('Trade list price, major currency units (§4.4); not a cost and not a tariff');
            $table->decimal('b2c_price_amount', 18, 6)->nullable()
                ->comment('Consumer list price, major currency units (§4.4)');
            $table->string('price_currency_code', 3)->nullable();

            $table->foreign('price_currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        // A monetary value without its currency is not a monetary value (§4.4).
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_price_currency_check CHECK ((b2b_price_amount IS NULL AND b2c_price_amount IS NULL) OR price_currency_code IS NOT NULL)');

        // Zero is a legitimate list price (a giveaway, an included condiment);
        // a negative one is a data-entry accident every time.
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_b2b_price_amount_check CHECK (b2b_price_amount IS NULL OR b2b_price_amount >= 0)');
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_b2c_price_amount_check CHECK (b2c_price_amount IS NULL OR b2c_price_amount >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_b2c_price_amount_check');
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_b2b_price_amount_check');
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_price_currency_check');

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropForeign(['price_currency_code']);
            $table->dropColumn(['b2b_price_amount', 'b2c_price_amount', 'price_currency_code']);
        });
    }
};
