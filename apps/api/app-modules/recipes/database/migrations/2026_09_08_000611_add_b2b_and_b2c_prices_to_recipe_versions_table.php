<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The two list prices a recipe version is sold at, per unit of its yield:
 * `b2b_price_amount` to a kitchen or corporate buyer, `b2c_price_amount` to a
 * diner.
 *
 * **Two prices, replacing the editor's single "selling price".** One figure
 * could only ever be right for one of the two channels, so the margin it fed
 * was right for one of them too. The same pair already sits on `ingredients`
 * (`2026_09_05_000001`), and a recipe that is sold is priced the same way the
 * raw material it is made from is.
 *
 * **These are list prices on the version, not costs and not a price list.**
 * The distinction is the same one `ingredients` draws, and the reason these
 * columns can live here at all:
 *
 * - A *cost* is what this kitchen paid for the inputs. It is summed from the
 *   line costs and the moving averages behind them, it moves with every
 *   receipt, and `RecipeCostingService` owns it. Nothing here is read by that
 *   service, and it must never read these.
 * - A *channel tariff* — what a specific price list charges a specific segment
 *   on a specific date — stays in `price_lists` / `price_list_items`.
 *
 * What is left, and what these two columns are, is the standing figure an
 * operator types on the costing sheet beside the cost cascade, and the
 * numerator of the gross margin the editor reads back.
 *
 * **On the version, not on the recipe.** The margin is stated against *this*
 * version's cost, and the cost is a property of this version's lines, yield
 * and waste. Publishing freezes a version; a price on the recipe would let a
 * later reprice silently restate what a published version claimed it was sold
 * for. `newDraft` copies both figures forward, so opening the next draft
 * inherits the prices rather than blanking them.
 *
 * `decimal(18, 6)` in **major** currency units, matching every other monetary
 * column in the schema (master plan v2 §4.4) — never minor units, never a
 * float. `price_currency_code` is one currency for both amounts: a single
 * version quoted in two different currencies is a price list, not a column.
 * The CHECK mirrors `ingredients_price_currency_check` — a monetary value
 * without its currency is not a monetary value.
 *
 * Every existing row starts NULL. There is no selling price anywhere to
 * backfill from: the figure the editor collected was session state that was
 * never posted, so this is a landing zone for operator entry rather than a
 * migration of anything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->decimal('b2b_price_amount', 18, 6)->nullable()
                ->comment('Trade list price per yield unit, major currency units (§4.4); not a cost and not a tariff');
            $table->decimal('b2c_price_amount', 18, 6)->nullable()
                ->comment('Consumer list price per yield unit, major currency units (§4.4)');
            $table->string('price_currency_code', 3)->nullable();

            $table->foreign('price_currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        // A monetary value without its currency is not a monetary value (§4.4).
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_price_currency_check CHECK ((b2b_price_amount IS NULL AND b2c_price_amount IS NULL) OR price_currency_code IS NOT NULL)');

        // Zero is a legitimate list price — a staff meal, a tasting portion, a
        // component sold at cost inside a plan. A negative one is a data-entry
        // accident every time.
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_b2b_price_amount_check CHECK (b2b_price_amount IS NULL OR b2b_price_amount >= 0)');
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_b2c_price_amount_check CHECK (b2c_price_amount IS NULL OR b2c_price_amount >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE recipe_versions DROP CONSTRAINT IF EXISTS recipe_versions_b2c_price_amount_check');
        DB::statement('ALTER TABLE recipe_versions DROP CONSTRAINT IF EXISTS recipe_versions_b2b_price_amount_check');
        DB::statement('ALTER TABLE recipe_versions DROP CONSTRAINT IF EXISTS recipe_versions_price_currency_check');

        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->dropForeign(['price_currency_code']);
            $table->dropColumn(['b2b_price_amount', 'b2c_price_amount', 'price_currency_code']);
        });
    }
};
