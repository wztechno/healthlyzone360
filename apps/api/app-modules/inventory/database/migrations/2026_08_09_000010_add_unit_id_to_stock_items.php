<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * `stock_items.unit_id` (INV1.0): a real foreign key to `measurement_units`,
 * replacing the free-text `unit_code` as the thing everything downstream reads.
 * A deduction that has to divide a recipe quantity into a stock item's own unit
 * cannot trust a string that might say `kg`, `Kg` or `kilogram`; it needs a row.
 *
 * `restrictOnDelete`, not cascade: a stock item that measures itself in
 * kilograms must not lose its unit because somebody deactivated a reference row,
 * and the reference vocabulary is platform-governed anyway (nobody deletes `kg`).
 *
 * **Nullable, deliberately, in this slice.** Making it NOT NULL would couple
 * stock-item creation to measurement-unit seeding order — on a fresh database
 * the units are seeded *after* every migration runs, so there is no `kg` row to
 * point a NOT NULL default at — and INV1.0's job is to make the column exist and
 * carry the truth for the rows that exist, not to tighten a constraint the
 * purchasing path (INV1.1) is better placed to guarantee. `unit_code` is kept
 * alongside it for now rather than dropped: the existing API still writes and
 * reads it, and dropping a column a client depends on is a contract change that
 * belongs with the slice that reworks that surface.
 *
 * Backfill maps each row's `unit_code` to the matching unit; an unrecognised
 * code falls back to `kg` with a logged note, exactly as the plan specifies, so
 * a mystery string becomes a visible data-quality event rather than a silent
 * null. On a fresh database both tables are empty and the loop does nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_items', function (Blueprint $table): void {
            $table->foreignUuid('unit_id')
                ->nullable()
                ->after('unit_code')
                ->constrained('measurement_units')
                ->restrictOnDelete();
        });

        /** @var array<string, string> $unitsByCode */
        $unitsByCode = DB::table('measurement_units')->pluck('id', 'code')->all();

        if ($unitsByCode === []) {
            return;
        }

        $fallback = $unitsByCode['kg'] ?? null;

        /** @var iterable<object{id: string, unit_code: string|null}> $rows */
        $rows = DB::table('stock_items')->select('id', 'unit_code')->get();

        foreach ($rows as $row) {
            $unitId = $unitsByCode[$row->unit_code] ?? null;

            if ($unitId === null) {
                $unitId = $fallback;

                Log::warning('INV1.0 stock_items.unit_id backfill: unrecognised unit_code, defaulted to kg.', [
                    'stock_item_id' => $row->id,
                    'unit_code' => $row->unit_code,
                ]);
            }

            if ($unitId !== null) {
                DB::table('stock_items')->where('id', $row->id)->update(['unit_id' => $unitId]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('stock_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('unit_id');
        });
    }
};
