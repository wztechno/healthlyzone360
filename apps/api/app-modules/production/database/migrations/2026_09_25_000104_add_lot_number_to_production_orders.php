<?php

declare(strict_types=1);

use Healthy360\Production\Services\ProductionOrderNumbers;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The lot: the number on the label and inside its barcode (D-145).
 *
 * `YYMMDD` of the production date, a three-digit sequence for that organisation
 * and day, and a GS1 mod-10 check digit — `2609250077`, shown `260925-007-7`.
 * {@see ProductionOrderNumbers} mints it and says why it has that shape.
 *
 * **A second number beside `reference`, not a replacement for it.** `reference`
 * (`PB-…`) names the work order and exists from confirm; the lot names what the
 * batch *made*, and exists only once usable units reach a shelf. A batch that
 * produced nothing has a reference and never a lot.
 *
 * Stored as the ten digits, never with its dashes: the dashes are presentation,
 * and a lookup that had to know whether they were stored would be two lookups.
 * The CHECK holds that shape so a hand-written UPDATE cannot slip a
 * printable-but-unscannable value past the minting code.
 *
 * **Unique per organisation, partial**, the `production_orders_reference_unique`
 * pattern: most rows have no lot and several nulls are not a collision. The
 * minting code serialises itself with an advisory lock; this index is the
 * backstop that makes a lock bug a failed write rather than two batches wearing
 * one label.
 *
 * Every existing row starts NULL. Batches completed before this carry whatever
 * the cook wrote in `batch_reference`, and inventing lots for them would print a
 * number on a screen that no label in the kitchen ever carried.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('production_orders', function (Blueprint $table): void {
            $table->string('lot_number', 10)->nullable()->after('reference')
                ->comment('YYMMDD + daily sequence + GS1 check digit; minted when usable units reach a shelf, never changed');
        });

        DB::statement("ALTER TABLE production_orders ADD CONSTRAINT production_orders_lot_number_check CHECK (lot_number ~ '^[0-9]{10}$')");

        DB::statement('CREATE UNIQUE INDEX production_orders_lot_number_unique ON production_orders (organisation_id, lot_number) WHERE lot_number IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS production_orders_lot_number_unique');
        DB::statement('ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_lot_number_check');

        Schema::table('production_orders', function (Blueprint $table): void {
            $table->dropColumn('lot_number');
        });
    }
};
