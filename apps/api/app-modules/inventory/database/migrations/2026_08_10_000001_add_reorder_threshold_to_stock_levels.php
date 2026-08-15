<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `stock_levels.reorder_threshold` and `.par_level` (INV1.3): the reorder
 * point a low-stock flag reads against.
 *
 * Both are per-(branch, stock item) — the same grain the row already carries —
 * and both are **nullable on purpose**: a null `reorder_threshold` is "no
 * threshold set", which the low-stock computation reads as *never low* rather
 * than as zero. No flag is stored; low-stock is computed on read exactly as
 * out-of-stock already is (`ops-format.ts`), so there is no boolean column and
 * no job here. `par_level` is the level a manager restocks back up to — recorded
 * beside the threshold, unused by the computation, kept nullable for the same
 * "not set" reason.
 *
 * `decimal(14,4)` matches `quantity` so the two compare without a cast, and on a
 * fresh database the columns land on an empty table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_levels', function (Blueprint $table): void {
            $table->decimal('reorder_threshold', 14, 4)->nullable()->after('quantity');
            $table->decimal('par_level', 14, 4)->nullable()->after('reorder_threshold');
        });
    }

    public function down(): void
    {
        Schema::table('stock_levels', function (Blueprint $table): void {
            $table->dropColumn(['reorder_threshold', 'par_level']);
        });
    }
};
