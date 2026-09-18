<?php

declare(strict_types=1);

use Healthy360\Procurement\Services\LastPurchasePriceQuery;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The weekly weighted-average purchase price of an ingredient, and the
 * publication that produced a set of them (PROD1).
 *
 * A **fourth** cost figure, and the reason it is a fourth rather than a
 * replacement is worth stating once, here, because four is otherwise indefensible:
 *
 * - `ingredients.purchase_price_amount` — what an operator typed. A list price.
 * - `goods_receipt_lines.unit_price_amount` — what a supplier actually charged on
 *   one delivery. History, never rewritten.
 * - `ingredient_stock_costs.moving_average_cost_amount` — what the stock on the
 *   shelf is worth. The valuation basis, and what COGS is read at.
 * - **this** — what a kilo cost *on average last week*. An estimating basis, for
 *   recipe costing, technical sheets and production estimates, where a moving
 *   average is the wrong answer (it lags by however long the shelf turns over)
 *   and the last purchase is the wrong answer (it is one delivery's luck).
 *
 * ## Append-only, and therefore standing-ness is derived
 *
 * A production batch pins the publication it was estimated against, so a published
 * price that could be updated would silently rewrite what a completed batch is
 * recorded as having estimated. `REVOKE UPDATE, DELETE` lands in the paired
 * migration beside this one — the treatment `stock_movements`,
 * `ingredient_cost_events` and `recipe_cost_snapshots` already carry.
 *
 * That rules out an `effective_to_date` closed on supersession, and a partial
 * unique index on the open-ended row with it: both need an UPDATE the runtime role
 * will not have. So there is no such column. **The standing price is the newest
 * row by `effective_from_date`, then `published_at`, then `id`** — derived on read
 * exactly the way {@see LastPurchasePriceQuery}
 * derives the last purchase price, and for the same reason it gives there:
 * "nothing here is stored" cannot drift from the rows it summarises.
 *
 * A recompute of an already-published week inserts a second publication naming the
 * first in `supersedes_id`. Both stay readable, the older stays pinned to whatever
 * pinned it, and the newer wins the ordering above. `published_at` is part of the
 * uniqueness for that reason rather than the week alone.
 *
 * ## The purchase week and the effective week are different weeks
 *
 * Purchases made in week W are averaged and the result takes effect on the Monday
 * of W+1 — you cannot cost Tuesday's batch at an average of a week that has not
 * finished. Storing only one of the two would leave every reader guessing which it
 * was, so both are columns.
 *
 * ## Why `source` and `carry_reason` are separate columns
 *
 * `source` says what the row *is* — a computed average, last week's carried
 * forward, or an admission that there is no price at all. `carry_reason` says
 * **why** carrying was necessary, and a kitchen needs it: "nothing was bought" is
 * a shrug, "the week's purchases were in two currencies" and "the ingredient's
 * unit changed and the old price will not convert" are both work somebody has to
 * do. Folding them into one enum would make those three indistinguishable on
 * screen.
 *
 * `unit_id` is stored per row rather than read from the ingredient, because the
 * ingredient's default unit can move underneath a published price and a price per
 * unit is meaningless without the unit it is per — the lesson
 * `IngredientCostService::rebaseHeldBalance()` learned the hard way.
 *
 * Isolation strategy: `app-scope` — both tables carry `organisation_id` and are
 * read only through services that scope on it explicitly. No RLS policy: these are
 * cost figures rather than formulations, and every surface over them sits behind
 * `inventory.view_costs_organisation`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('weekly_price_publications', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();

            $table->date('purchase_week_start_date')->comment('Monday of the averaged week, organisation-local');
            $table->date('purchase_week_end_date')->comment('Sunday of the averaged week, organisation-local');
            $table->date('effective_from_date')->comment('the Monday these prices take effect: purchase week end + 1 day');

            $table->string('timezone', 64)->comment('the clock the week boundaries were resolved in');
            $table->timestamp('published_at');

            $table->unsignedInteger('ingredient_count')->default(0);
            $table->unsignedInteger('computed_count')->default(0);
            $table->unsignedInteger('carried_count')->default(0);
            $table->unsignedInteger('unpriced_count')->default(0);
            $table->unsignedInteger('late_line_count')->default(0)->comment('lines for this week posted after this publication');
            $table->boolean('has_late_receipts')->default(false);

            $table->uuid('supersedes_id')->nullable()->comment('the publication this one recomputes and replaces');

            $table->timestamp('created_at')->nullable();

            $table->unique(['organisation_id', 'purchase_week_start_date', 'published_at'], 'weekly_price_publications_week_unique');
            $table->index(['organisation_id', 'purchase_week_start_date']);
        });

        DB::statement('ALTER TABLE weekly_price_publications ADD CONSTRAINT weekly_price_publications_week_order_check CHECK (purchase_week_end_date > purchase_week_start_date AND effective_from_date > purchase_week_end_date)');

        // The self-reference is added after the table exists rather than inside
        // `create()`: PostgreSQL will not accept a foreign key pointing at a
        // primary key the same statement has not finished declaring.
        Schema::table('weekly_price_publications', function (Blueprint $table): void {
            $table->foreign('supersedes_id')->references('id')->on('weekly_price_publications')->nullOnDelete();
        });

        Schema::create('ingredient_weekly_prices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('weekly_price_publication_id')->constrained('weekly_price_publications')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();

            $table->date('purchase_week_start_date');
            $table->date('purchase_week_end_date');
            $table->date('effective_from_date');

            $table->foreignUuid('unit_id')->nullable()
                ->comment('the unit the average is per; null only when source is unpriced')
                ->constrained('measurement_units')->restrictOnDelete();
            $table->decimal('average_unit_amount', 18, 6)->nullable()->comment('major currency units (§4.4), never minor');
            $table->char('currency_code', 3)->nullable();
            $table->decimal('total_quantity', 18, 6)->nullable()->comment('in unit_id: the average\'s denominator');
            $table->decimal('total_cost_amount', 18, 6)->nullable()->comment('the average\'s numerator');
            $table->unsignedInteger('receipt_line_count')->default(0);
            $table->unsignedInteger('unpriced_line_count')->default(0);
            $table->boolean('has_unpriced_lines')->default(false);

            $table->string('source', 16);
            $table->string('carry_reason', 24)->nullable();
            $table->date('carried_from_week_start_date')->nullable();

            $table->timestamp('created_at')->nullable();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique(['weekly_price_publication_id', 'ingredient_id'], 'ingredient_weekly_prices_publication_unique');
            $table->index(['organisation_id', 'ingredient_id', 'effective_from_date']);
        });

        DB::statement("ALTER TABLE ingredient_weekly_prices ADD CONSTRAINT ingredient_weekly_prices_source_check CHECK (source IN ('computed', 'carried_forward', 'unpriced'))");

        DB::statement("ALTER TABLE ingredient_weekly_prices ADD CONSTRAINT ingredient_weekly_prices_carry_reason_check CHECK (carry_reason IS NULL OR carry_reason IN ('no_purchases', 'mixed_currency', 'all_lines_unpriced', 'not_convertible'))");

        // A monetary value without its currency is not a monetary value (§4.4),
        // and an amount per no unit is not a unit price. `unpriced` carries
        // neither, which is exactly what it means.
        DB::statement('ALTER TABLE ingredient_weekly_prices ADD CONSTRAINT ingredient_weekly_prices_amount_check CHECK ((average_unit_amount IS NULL AND currency_code IS NULL AND unit_id IS NULL) OR (average_unit_amount IS NOT NULL AND currency_code IS NOT NULL AND unit_id IS NOT NULL))');

        DB::statement("ALTER TABLE ingredient_weekly_prices ADD CONSTRAINT ingredient_weekly_prices_priced_source_check CHECK ((source = 'unpriced') = (average_unit_amount IS NULL))");

        DB::statement("ALTER TABLE ingredient_weekly_prices ADD CONSTRAINT ingredient_weekly_prices_carry_evidence_check CHECK ((source = 'carried_forward') = (carried_from_week_start_date IS NOT NULL))");

        DB::statement('ALTER TABLE ingredient_weekly_prices ADD CONSTRAINT ingredient_weekly_prices_quantity_check CHECK (total_quantity IS NULL OR total_quantity > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_weekly_prices');
        Schema::dropIfExists('weekly_price_publications');
    }
};
