<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The same three columns `order_lines` gained, for the same reason: a repeat add
 * merges only into a line that is otherwise the same dish made the same way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cart_items', function (Blueprint $table): void {
            $table->jsonb('selected_options')->nullable()->comment('what was chosen, as served back; re-read from the dish at placement');
            $table->string('note', 300)->nullable();
            $table->string('line_key', 40)->default('');
        });

        DB::statement('DROP INDEX cart_items_one_row_per_line');
        DB::statement('CREATE UNIQUE INDEX cart_items_one_row_per_line ON cart_items (cart_id, catalogue_item_id, catalogue_item_variant_id, delivery_date, line_key) NULLS NOT DISTINCT');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX cart_items_one_row_per_line');
        DB::statement('CREATE UNIQUE INDEX cart_items_one_row_per_line ON cart_items (cart_id, catalogue_item_id, catalogue_item_variant_id, delivery_date) NULLS NOT DISTINCT');

        Schema::table('cart_items', function (Blueprint $table): void {
            $table->dropColumn(['selected_options', 'note', 'line_key']);
        });
    }
};
