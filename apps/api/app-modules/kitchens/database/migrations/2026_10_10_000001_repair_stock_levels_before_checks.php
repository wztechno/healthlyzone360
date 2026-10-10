<?php

declare(strict_types=1);

use Healthy360\Kitchens\Console\SimulateStockCommand;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Two rules move from the screen into the table, owner's ruling October 2026:
 *
 * - **No shelf below zero** — `stock_levels.quantity >= 0`.
 * - **Par above the reorder threshold** — when both are set, `par_level > reorder_threshold`.
 *   Restocking to the threshold itself would leave the shelf low the moment it is booked in.
 *
 * A database written before either rule may break both, so the rows are repaired first:
 *
 * - **A shelf below zero** is counted back to zero with an `adjust` movement, so the ledger still
 *   sums to the level and the correction is visible in the shelf's history.
 * - **A par at or below its threshold** is put back to what `kitchen:simulate-stock` seeds for that
 *   shelf — threshold and par together, never one of the pair, since there is no knowing which half
 *   was the typo. A shelf the command does not stock (one the kitchen makes itself) was never seeded
 *   a pair, so it goes back to none.
 *
 * On a fresh database there is nothing to repair and the command is never asked.
 *
 * down() drops the constraints and leaves the repaired data: putting a negative shelf back would
 * need a movement that takes it there.
 */
return new class extends Migration
{
    private const string NOTE = 'Counted back to zero: the shelf was below zero before negative stock was refused.';

    public function up(): void
    {
        $this->countNegativeShelvesToZero();
        $this->restoreSeededPairs();

        DB::statement('ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_quantity_non_negative CHECK (quantity >= 0)');
        DB::statement('ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_par_above_threshold CHECK (par_level IS NULL OR reorder_threshold IS NULL OR par_level > reorder_threshold)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE stock_levels DROP CONSTRAINT IF EXISTS stock_levels_par_above_threshold');
        DB::statement('ALTER TABLE stock_levels DROP CONSTRAINT IF EXISTS stock_levels_quantity_non_negative');
    }

    private function countNegativeShelvesToZero(): void
    {
        $shelves = DB::table('stock_levels')
            ->join('stock_items', 'stock_items.id', '=', 'stock_levels.stock_item_id')
            ->where('stock_levels.quantity', '<', 0)
            ->get(['stock_levels.id', 'stock_levels.branch_id', 'stock_levels.stock_item_id', 'stock_levels.quantity', 'stock_items.organisation_id']);

        foreach ($shelves as $shelf) {
            $now = now();

            DB::table('stock_movements')->insert([
                'id' => (string) Str::uuid(),
                'organisation_id' => $shelf->organisation_id,
                'branch_id' => $shelf->branch_id,
                'stock_item_id' => $shelf->stock_item_id,
                'quantity_delta' => ltrim((string) $shelf->quantity, '-'),
                'reason' => 'adjust',
                'notes' => self::NOTE,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('stock_levels')->where('id', $shelf->id)->update(['quantity' => '0', 'updated_at' => $now]);
        }
    }

    private function restoreSeededPairs(): void
    {
        $broken = DB::table('stock_levels')
            ->join('stock_items', 'stock_items.id', '=', 'stock_levels.stock_item_id')
            ->whereNotNull('stock_levels.reorder_threshold')
            ->whereNotNull('stock_levels.par_level')
            ->whereColumn('stock_levels.par_level', '<=', 'stock_levels.reorder_threshold')
            ->get(['stock_levels.id', 'stock_levels.stock_item_id', 'stock_items.organisation_id']);

        if ($broken->isEmpty()) {
            return;
        }

        $simulation = app(SimulateStockCommand::class);

        foreach ($broken->groupBy('organisation_id') as $organisationId => $levels) {
            $seeded = $simulation->seededLevels((string) $organisationId);

            foreach ($levels as $level) {
                $pair = $seeded[(string) $level->stock_item_id] ?? null;

                DB::table('stock_levels')->where('id', $level->id)->update([
                    'reorder_threshold' => $pair['threshold'] ?? null,
                    'par_level' => $pair['par'] ?? null,
                    'updated_at' => now(),
                ]);
            }
        }
    }
};
