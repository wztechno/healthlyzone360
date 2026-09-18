<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a sold line was **estimated** to cost, frozen at the moment it was
 * confirmed (PROD1).
 *
 * ## Why a table rather than a computation
 *
 * The monthly report can already say what a month's sales actually cost: the
 * consume movements carry their moving-average valuation and sum to COGS. What it
 * cannot say is what those sales were *expected* to cost, which is the figure a
 * kitchen prices against — and re-deriving it later is not the same question. A
 * recipe edited in October would change September's estimated margin, and a
 * weekly price published on Monday would change last month's. Both are wrong
 * answers to "how did we do", and both are silent.
 *
 * So the estimate is written **once**, at confirm, from the prices standing at
 * that moment, and the publication it stood on is recorded beside it. Last
 * month's estimated margin then stays what it was.
 *
 * ## Why it lives in Inventory
 *
 * `OrderConsumptionService` already runs inside the confirm transaction and
 * already reads Orders and Recipes to explode the line. Writing this anywhere
 * else would mean a second pass over the same recipe at the same moment, or a
 * job that could run after the price moved — which is the failure the table
 * exists to prevent.
 *
 * ## One row per line, and a missing row is not a zero
 *
 * `UNIQUE (order_line_id)`. A line whose estimate could not be computed — no
 * recipe, no price, two currencies — writes **no row**, and the report counts the
 * absences rather than summing them as free. An estimated margin over the lines
 * that happened to have estimates would read exactly like a complete one and be
 * too high.
 *
 * Isolation strategy: `join-rls-parent` (app-scope) — reached only through
 * `orders`, which carries no policy itself, so a predicate here would be
 * evaluated on every row to protect what resolving the parent already decided.
 * The `order_payment_receipts` argument, inherited.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_line_estimated_costs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('order_line_id')->constrained('order_lines')->cascadeOnDelete();

            $table->decimal('estimated_cost_amount', 18, 6)->comment('what this line was expected to cost, at the prices standing when the order was confirmed');
            $table->string('currency_code', 3);

            // Soft, for the reason `production_orders` gives: the publication
            // lives in Procurement and is append-only, so a schema edge here
            // would buy nothing.
            $table->uuid('weekly_price_publication_id')->nullable()->comment('the price basis the estimate stood on. Soft reference to weekly_price_publications');

            $table->timestamps();

            // One estimate per line. A confirm that ran twice must not write two.
            $table->unique('order_line_id');

            // The monthly report's read: this organisation's estimates for a month.
            $table->index(['organisation_id', 'order_id']);
        });

        DB::statement('ALTER TABLE order_line_estimated_costs ADD CONSTRAINT order_line_estimated_costs_amount_check CHECK (estimated_cost_amount >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('order_line_estimated_costs');
    }
};
