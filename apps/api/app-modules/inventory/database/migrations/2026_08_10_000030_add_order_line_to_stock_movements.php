<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Attribute a consume movement to the order *line* and the kind of thing sold,
 * so COGS can be split meal-versus-product without a join at report time (INV1.5).
 *
 * INV1.2 stamped a consume movement with `reference_type='order'` and the order
 * id. That is enough to sum a month's COGS and to find every one of an order's
 * consume movements for reversal, but it cannot say which *line* — or which line
 * of business — a deduction belonged to, so the monthly report can split revenue
 * by `item_type` (the order line records it) yet cannot split COGS the same way.
 *
 * Two nullable columns close that gap, both on the inventory ledger where cost is
 * already allowed to live (never on the order — `OrderArchitectureTest`):
 *
 * - `order_line_id` — the order line this consume served. A meal line explodes
 *   into one consume per ingredient, so several movements share one
 *   `order_line_id`; together with `stock_item_id` it identifies each ingredient
 *   deduction of a line exactly, which is what lets a retry re-run only the
 *   still-unresolved parts of an order without double-deducting what already
 *   succeeded (INV1.5 Part A).
 * - `sold_item_type` — `meal` or `product`, denormalised from the catalogue item
 *   at consume time so the report groups COGS by line of business with no join to
 *   `catalogue_items` and no guess at shared ingredients.
 *
 * Both are nullable: every non-consume movement (receipt, waste, adjust, yield,
 * production consume/yield) leaves them null, and a consume whose order predates
 * this migration keeps them null too — the report reads such a month's COGS as an
 * unsplit total rather than inventing an attribution. The reversal path is
 * unchanged: it still finds an order's consume movements by `reference_type` /
 * `reference_id`, so restoring a cancelled order does not depend on either column.
 *
 * `order_line_id` is a soft reference — a plain indexed uuid, no foreign key —
 * for the same reason `order_consumption_exceptions.order_id` is: a database FK
 * would couple this migration to the orders schema's creation order, where the
 * declared Inventory → Orders module edge already makes the reference legal.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->uuid('order_line_id')->nullable()->after('reference_id');
            $table->string('sold_item_type', 32)->nullable()->after('order_line_id')->comment('meal | product, denormalised from the sold catalogue item so COGS splits by line of business without a join (INV1.5)');

            // The retry idempotency guard reads by (reference_type, reference_id,
            // order_line_id, stock_item_id); the report groups a month's consume
            // movements by sold_item_type. This index serves both.
            $table->index(['reference_type', 'reference_id', 'order_line_id', 'stock_item_id'], 'stock_movements_order_line_idx');
        });
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->dropIndex('stock_movements_order_line_idx');
            $table->dropColumn(['order_line_id', 'sold_item_type']);
        });
    }
};
