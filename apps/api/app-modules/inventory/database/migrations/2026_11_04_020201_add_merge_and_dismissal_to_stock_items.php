<?php

declare(strict_types=1);

use Healthy360\Inventory\Services\DuplicateStockShelves;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two answers a kitchen can give to a pair of same-named shelves that both have
 * history ({@see DuplicateStockShelves}).
 *
 * **Merge** links the emptied shelf to the one that stays rather than deleting it:
 * its movements are append-only and cascade with the row, so the row has to stay
 * for its history to stay. `nullOnDelete`, so the kept shelf going never takes the
 * linked one with it.
 *
 * **Keep both** stamps the group's rows, and the review list skips a group whose
 * rows are all stamped. A new shelf of the same name is unstamped, so it brings the
 * group back.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_items', function (Blueprint $table): void {
            $table->foreignUuid('merged_into_stock_item_id')->nullable()->constrained('stock_items')->nullOnDelete();
            $table->timestampTz('duplicate_dismissed_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('stock_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('merged_into_stock_item_id');
            $table->dropColumn('duplicate_dismissed_at');
        });
    }
};
