<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The bill of materials a batch was confirmed against, and what actually
 * happened to each line (PROD1).
 *
 * ## Why the explosion is stored rather than recomputed
 *
 * A production order could re-explode its recipe version every time somebody
 * opened it, and for as long as nothing changed the answer would match. Recipes
 * change, prices change, and an ingredient's shelf can be re-derived — so a batch
 * confirmed in March and read in May would silently be a different batch. These
 * rows are what the kitchen committed to, which is also what its reservations are
 * against and what its estimated cost was computed from. Recomputing would make
 * all three disagree with each other.
 *
 * ## Two kinds of line, because the two behave differently
 *
 * `line_kind` is `ingredient | packaging`. A cook reports what actually went into
 * the pot and what was thrown away; packaging is taken as planned or not at all.
 * The split also matters downstream: the finished-stock sale path must not deduct
 * packaging again, and it can only know that because production recorded taking
 * it here.
 *
 * ## Four quantities, none of which is derivable from the others
 *
 * `required_quantity` is the plan. `reserved_quantity` is what was actually
 * claimed — equal to required in the ordinary case and *not* equal after a
 * physical correction left the shelf short. `consumed_quantity` is what went into
 * the batch. `waste_quantity` is input thrown away, which is **not** part of
 * consumed: the shelf falls by their sum, as two movements with different
 * reasons, because the monthly report reads waste separately and adding them
 * would count the loss as cost of goods.
 *
 * ## The cost columns are a snapshot, not a cache
 *
 * `estimated_unit_cost_amount` with its `cost_source` — `weekly`, `component` or
 * `fallback` — is what this line was estimated at and which basis said so, frozen
 * at confirm. `fallback_unit_cost_amount` records the figure actually used when
 * the weekly price was missing, so a reader can tell an estimate that stood on
 * last week's purchases from one that stood on an ingredient's typed cost.
 * `actual_unit_cost_amount` is the moving average at the moment of completion.
 * `valued_at` is what makes late valuation once-only — the `goods_receipt_lines`
 * `costed_at` precedent — so completing a cost later can never re-post stock.
 *
 * `source_recipe_version_id` names the version that supplied a produced
 * component's cost, which is the version claiming that ingredient's nutrition.
 * Without it, a sheet read in May cannot reproduce what it said in March.
 *
 * Isolation strategy: `join-rls-parent` (app-scope) — reached only through
 * `production_orders`, which carries no policy itself, so a predicate here would
 * be evaluated on every row to protect what resolving the parent already decided.
 * The denormalised `organisation_id` is present so that decision can be revisited
 * without a migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_order_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('production_order_id')->constrained('production_orders')->cascadeOnDelete();

            $table->foreignUuid('stock_item_id')->constrained('stock_items')->restrictOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();

            $table->string('line_kind', 16);

            // Which version supplied a produced component's cost and nutrition.
            // Null for an ordinary bought-in ingredient, which is most lines.
            $table->foreignUuid('source_recipe_version_id')->nullable()->constrained('recipe_versions')->restrictOnDelete();

            $table->decimal('required_quantity', 14, 4)->comment("the plan, in the stock item's own unit");
            $table->foreignUuid('unit_id')->constrained('measurement_units')->restrictOnDelete();

            $table->decimal('reserved_quantity', 14, 4)->nullable()->comment('what was actually claimed at confirm; may be below required after a physical correction');
            $table->decimal('consumed_quantity', 14, 4)->nullable()->comment('what went into the batch — never includes input waste');
            $table->decimal('waste_quantity', 14, 4)->nullable()->comment('input discarded during the batch; a separate movement with a separate reason');

            $table->decimal('estimated_unit_cost_amount', 18, 6)->nullable()->comment('per unit_id, frozen at confirm');
            $table->string('cost_source', 16)->nullable();
            $table->decimal('fallback_unit_cost_amount', 18, 6)->nullable()->comment('the figure used when no weekly price existed, so a reader can tell the two bases apart');
            $table->decimal('actual_unit_cost_amount', 18, 6)->nullable()->comment('the moving average at completion, per unit_id');
            $table->string('cost_currency_code', 3)->nullable();
            $table->timestamp('valued_at')->nullable()->comment('once-only stamp for late valuation; the goods_receipt_lines costed_at precedent');

            $table->unsignedInteger('display_order')->default(0);
            $table->timestamps();

            // One line per shelf per kind. A recipe naming the same oil twice is
            // summed by the explosion long before it reaches here.
            $table->unique(['production_order_id', 'stock_item_id', 'line_kind']);

            // The lines of one order, in the order they were written.
            $table->index(['production_order_id', 'display_order']);
        });

        DB::statement("ALTER TABLE production_order_lines ADD CONSTRAINT production_order_lines_kind_check CHECK (line_kind IN ('ingredient', 'packaging'))");

        DB::statement("ALTER TABLE production_order_lines ADD CONSTRAINT production_order_lines_cost_source_check CHECK (cost_source IS NULL OR cost_source IN ('weekly', 'component', 'fallback'))");

        DB::statement('ALTER TABLE production_order_lines ADD CONSTRAINT production_order_lines_quantities_check CHECK (required_quantity >= 0 AND (reserved_quantity IS NULL OR reserved_quantity >= 0) AND (consumed_quantity IS NULL OR consumed_quantity >= 0) AND (waste_quantity IS NULL OR waste_quantity >= 0))');

        // The house money rule: an amount without a currency is not a figure.
        DB::statement('ALTER TABLE production_order_lines ADD CONSTRAINT production_order_lines_currency_check CHECK (cost_currency_code IS NOT NULL OR (estimated_unit_cost_amount IS NULL AND fallback_unit_cost_amount IS NULL AND actual_unit_cost_amount IS NULL))');
    }

    public function down(): void
    {
        Schema::dropIfExists('production_order_lines');
    }
};
