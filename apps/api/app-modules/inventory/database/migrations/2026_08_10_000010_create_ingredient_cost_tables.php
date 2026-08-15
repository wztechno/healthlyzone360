<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What an ingredient costs a kitchen, and the append-only record of how that
 * figure moved (INV1.1).
 *
 * The platform `ingredients` table stays cost-free by design (K1): a cost is
 * org-specific and time-varying, and belonging to the shared library it would
 * be one tenant's price on everybody's row. So the cost lives here, keyed by
 * `(organisation_id, ingredient_id)`, in two tables that split the same way
 * `stock_levels`/`stock_movements` do — a current value and the ledger behind
 * it.
 *
 * `ingredient_stock_costs` is the **weighted moving-average** current value:
 * `moving_average_cost_amount` is what a unit of the ingredient is worth today,
 * expressed per `unit_id` — always the ingredient's own `default_unit_id`, so a
 * purchase measured in grams and one measured in kilograms blend into one
 * consistent figure. `quantity_on_hand` is the basis quantity the average is
 * weighted over, in that same unit; a receipt raises it, and INV1.2's consume
 * path lowers it (COGS reads `moving_average_cost_amount`, never rewrites it).
 *
 * `ingredient_cost_events` is the ledger: one immutable row per priced receipt
 * line, carrying the quantity and unit cost received, the currency, and the
 * average and basis quantity that resulted. A REVOKE migration in this group
 * makes it append-only at the grant level, exactly as `stock_movements` is —
 * this is the audit trail behind every valuation figure.
 *
 * **`source_receipt_line_id` carries no foreign key, deliberately.** A real FK
 * to `goods_receipt_lines` would make this inventory table depend on the
 * procurement schema, and Procurement already depends on Inventory — the module
 * graph is asserted acyclic (`ModuleRegistryTest`), so the reference is a plain
 * indexed uuid a reader can join on, not a constraint that would close the
 * cycle. An append-only ledger must outlive the row it points at anyway.
 *
 * Amounts are `decimal(18,6)` in **major** currency units (master plan v2 §4.4),
 * and a monetary value never exists without its currency (the CHECK mirrors
 * `recipe_version_lines`). All arithmetic is bcmath at scale 6/12 — floats are
 * forbidden on money (`RecipeCostingService`).
 *
 * Isolation strategy: `org-rls` in vocabulary, application-scoped in this slice
 * (both tables carry `organisation_id` and `BelongsToOrganisation`), plus
 * `append-only-ledger` on the events table via the sibling REVOKE migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ingredient_stock_costs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->cascadeOnDelete();

            // The unit the average is expressed per — the ingredient's own
            // default unit, resolved once when the first purchase lands.
            $table->foreignUuid('unit_id')->constrained('measurement_units')->restrictOnDelete();

            // The basis quantity the moving average is weighted over, in unit_id.
            $table->decimal('quantity_on_hand', 18, 6)->default('0');

            $table->decimal('moving_average_cost_amount', 18, 6)->nullable()->comment('major currency units per unit_id (§4.4)');
            $table->decimal('last_purchase_cost_amount', 18, 6)->nullable()->comment('major currency units per unit_id (§4.4)');
            $table->string('currency_code', 3)->nullable();

            $table->timestamps();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
            $table->unique(['organisation_id', 'ingredient_id']);
        });

        // A monetary value without its currency is not a monetary value (§4.4).
        DB::statement('ALTER TABLE ingredient_stock_costs ADD CONSTRAINT ingredient_stock_costs_currency_check CHECK ((moving_average_cost_amount IS NULL AND last_purchase_cost_amount IS NULL) OR currency_code IS NOT NULL)');

        Schema::create('ingredient_cost_events', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->cascadeOnDelete();

            // A soft reference — see the class docblock on why there is no FK.
            $table->uuid('source_receipt_line_id')->nullable();

            $table->foreignUuid('unit_id')->constrained('measurement_units')->restrictOnDelete();

            $table->decimal('quantity', 18, 6)->comment('received quantity, in unit_id');
            $table->decimal('unit_cost_amount', 18, 6)->comment('received unit cost, per unit_id, major units');
            $table->decimal('line_total_amount', 18, 6)->comment('quantity × unit_cost, major units');
            $table->string('currency_code', 3);

            $table->decimal('resulting_average_amount', 18, 6)->comment('the moving average after this event');
            $table->decimal('resulting_quantity', 18, 6)->comment('the basis quantity after this event');

            $table->timestamps();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();
            $table->index(['organisation_id', 'ingredient_id', 'created_at']);
            $table->index('source_receipt_line_id');
        });

        DB::statement('ALTER TABLE ingredient_cost_events ADD CONSTRAINT ingredient_cost_events_quantity_check CHECK (quantity > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_cost_events');
        Schema::dropIfExists('ingredient_stock_costs');
    }
};
