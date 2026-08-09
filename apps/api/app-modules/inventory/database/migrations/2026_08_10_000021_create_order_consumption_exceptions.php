<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a confirmed order could not deduct honestly, and why (INV1.2).
 *
 * Auto-deduction never guesses. When a line's consumption cannot be resolved —
 * the meal links no published recipe version, the version states no piece count
 * to divide by, an ingredient has no stock item at the branch, a stock item has
 * no resolved unit, two units cannot be converted between, or no moving-average
 * cost exists to value the deduction — the confirm does not fail and it does not
 * fabricate a quantity. It deducts whatever *is* resolvable and writes a row
 * here, so the kitchen has a place to see that this order's stock figures are
 * incomplete and the report knows not to trust them silently.
 *
 * `order_id`, `order_line_id` and `catalogue_item_id` are **soft references** —
 * plain indexed uuids, no foreign keys — for the same reason `ingredient_cost_
 * events.source_receipt_line_id` is: the module registry now declares an
 * Inventory → Orders edge so a class-level reference is legal, but a database FK
 * would couple this migration to the orders schema's creation order, and an
 * exception is a record of a problem that must survive whatever happens to the
 * rows it points at. `reason_code` is CHECK-constrained to the closed vocabulary
 * the consumption service knows how to raise, so an unrecognised code is a
 * migration somebody writes on purpose rather than a typo that reaches a report.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_consumption_exceptions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();

            $table->uuid('order_id');
            $table->uuid('order_line_id')->nullable();
            $table->uuid('catalogue_item_id')->nullable();

            $table->string('reason_code', 48);
            $table->string('detail', 500)->nullable();

            $table->timestamps();

            $table->index(['organisation_id', 'order_id']);
            $table->index('order_id');
        });

        DB::statement(<<<'SQL'
            ALTER TABLE order_consumption_exceptions ADD CONSTRAINT order_consumption_exceptions_reason_check CHECK (reason_code IN (
                'no_branch',
                'no_catalogue_item',
                'no_recipe_version',
                'no_yield_piece_count',
                'unquantified_recipe_line',
                'no_ingredient_link',
                'no_stock_item',
                'no_stock_unit',
                'unit_conversion_unsupported',
                'no_ingredient_cost',
                'insufficient_stock'
            ))
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('order_consumption_exceptions');
    }
};
