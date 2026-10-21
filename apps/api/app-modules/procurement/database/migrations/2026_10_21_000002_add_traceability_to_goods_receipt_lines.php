<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "One step back" traceability on a delivery line (ingredient barcodes,
 * 2026-10-21, plan §4.3): which product arrived, in which supplier lot, with
 * which dates.
 *
 * - `gtin` snapshots the scanned product. Several brands can map to one
 *   ingredient, so two lines that share a lot text but differ in GTIN are two
 *   things and must not merge.
 * - `supplier_lot` is GS1 AI (10): at most 20 characters of the GS1 set.
 * - `expires_on` is AI (17) and `best_before_on` is AI (15). Two fields,
 *   because GS1 gives them two meanings.
 *
 * One item arriving in two lots or two brands is two lines; the order-line
 * index is not unique and received quantities are sums, so nothing else moves.
 * `supplier_lot` is indexed for the recall question, "which deliveries brought
 * lot X".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            $table->char('gtin', 14)->nullable()->comment('the product scanned at receiving, GTIN-14 normal form');
            $table->string('supplier_lot', 20)->nullable()->comment('GS1 AI (10), as the pack or the receiver gave it');
            $table->date('expires_on')->nullable()->comment('GS1 AI (17), or typed');
            $table->date('best_before_on')->nullable()->comment('GS1 AI (15), or typed');

            $table->index('supplier_lot');
        });

        DB::statement("ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_gtin_check CHECK (gtin ~ '^[0-9]{14}$')");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE goods_receipt_lines DROP CONSTRAINT IF EXISTS goods_receipt_lines_gtin_check');

        Schema::table('goods_receipt_lines', function (Blueprint $table): void {
            $table->dropIndex(['supplier_lot']);
            $table->dropColumn(['gtin', 'supplier_lot', 'expires_on', 'best_before_on']);
        });
    }
};
