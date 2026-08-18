<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `purchase_orders.status` is `varchar(16)`, and `partially_received` is
 * eighteen characters long.
 *
 * The stub table (2026_08_04) sized the column for the three statuses that
 * existed then; SUP4 widened the CHECK to admit all five and did not widen the
 * column underneath it, so the two longest values the constraint permits could
 * not physically be stored. Nothing caught it until SUP5 posted the first
 * partial delivery and PostgreSQL refused the update with a 22001 — the CHECK
 * and the column had been disagreeing about the same set of five strings since
 * the moment they were written.
 *
 * Widened to 32 rather than to exactly 18: the CHECK is the constraint that
 * decides which strings are legal, and a column sized to the longest value it
 * currently admits only re-creates this failure the next time a status is added.
 *
 * A separate migration rather than an edit to SUP4's, because that one has
 * already run everywhere this branch has been migrated — an amended file would
 * be a fix that only new databases received.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Raw `ALTER COLUMN` rather than a Blueprint `->change()`: `change()`
        // restates the whole column definition, which would silently drop the
        // default the stub set. Widening on its own touches nothing else.
        DB::statement('ALTER TABLE purchase_orders ALTER COLUMN status TYPE VARCHAR(32)');
    }

    /**
     * Back to sixteen. A narrowing refuses loudly if any row is holding one of
     * the two long statuses, which is the correct outcome rather than a
     * truncation: rolling back past the receiving slice does not un-receive the
     * deliveries that produced those rows.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE purchase_orders ALTER COLUMN status TYPE VARCHAR(16)');
    }
};
