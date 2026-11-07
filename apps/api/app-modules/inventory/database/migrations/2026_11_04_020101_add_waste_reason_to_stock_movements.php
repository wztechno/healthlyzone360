<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Why food was thrown away, from a fixed list, so the month's waste can be read by cause.
 *
 * Only a `waste` movement carries one. Existing rows stay null: the ledger is append-only
 * and has no back-fill, and a reader takes a null as `other`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->string('waste_reason', 24)->nullable()->comment('expired | spoiled | damaged | overproduced | customer_return | other; waste rows only, null before this column');
        });

        DB::statement("ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_waste_reason_check CHECK (waste_reason IS NULL OR (reason = 'waste' AND waste_reason IN ('expired', 'spoiled', 'damaged', 'overproduced', 'customer_return', 'other')))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_waste_reason_check');

        Schema::table('stock_movements', function (Blueprint $table): void {
            $table->dropColumn('waste_reason');
        });
    }
};
