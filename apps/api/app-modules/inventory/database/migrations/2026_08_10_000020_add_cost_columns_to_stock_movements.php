<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Where a consume movement records what the food cost the kitchen (INV1.2).
 *
 * This is the one place COGS is allowed to live. `OrderArchitectureTest` fails
 * the build if any column on `orders`/`order_lines` so much as contains the word
 * "cost" — an order records what the customer was charged, never what the food
 * cost — so the cost of a sale is captured here, on the inventory ledger that
 * already moves the stock, keyed by the movement's `reference_type='order'` and
 * `reference_id`. INV1.4's monthly report sums `cost_amount` over the month's
 * consume movements to get COGS.
 *
 * `unit_cost_amount` is the ingredient's moving-average cost at the moment of
 * consumption, per its default unit; `cost_amount` is that unit cost times the
 * quantity consumed, expressed in the same unit. Both are `decimal(18,6)` major
 * currency units (master plan v2 §4.4), the same shape and scale as
 * `ingredient_cost_events`, and all the arithmetic behind them is bcmath — a
 * COGS figure that changed when `0.1 + 0.2` was evaluated is not a COGS figure.
 *
 * The columns are nullable because most movements are not sales: a receipt, a
 * waste write-off, an adjustment and a production yield carry no COGS, and an
 * honest consume that could not be valued (no moving-average cost exists for the
 * ingredient yet) still deducts the stock and leaves these null rather than
 * inventing a price. The CHECK enforces the one rule that always holds — a
 * monetary amount never exists without its currency (§4.4, mirroring
 * `ingredient_stock_costs`).
 *
 * `stock_movements` is append-only at the grant level (INV1.0 revoked UPDATE),
 * so these values are written once, when the movement is inserted, and never
 * edited afterwards — which is exactly what an audit trail behind a cost figure
 * has to be.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->decimal('unit_cost_amount', 18, 6)->nullable()->after('quantity_delta')->comment('moving-average cost at consume time, per the ingredient default unit, major units (§4.4)');
            $table->decimal('cost_amount', 18, 6)->nullable()->after('unit_cost_amount')->comment('COGS: unit_cost × quantity consumed, major units (§4.4)');
            $table->char('cost_currency_code', 3)->nullable()->after('cost_amount');

            $table->foreign('cost_currency_code')->references('code')->on('currencies')->restrictOnDelete();
        });

        // A monetary value without its currency is not a monetary value (§4.4).
        DB::statement('ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_cost_currency_check CHECK ((unit_cost_amount IS NULL AND cost_amount IS NULL) OR cost_currency_code IS NOT NULL)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_cost_currency_check');

        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->dropForeign(['cost_currency_code']);
            $table->dropColumn(['unit_cost_amount', 'cost_amount', 'cost_currency_code']);
        });
    }
};
