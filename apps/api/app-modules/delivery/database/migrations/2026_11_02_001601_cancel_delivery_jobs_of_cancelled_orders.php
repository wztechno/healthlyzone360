<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Runs left open behind orders cancelled before cancelling closed the run.
 *
 * Those runs still sit on the drivers' Available list. This does once what
 * `DeliveryJobProjector::cancel()` now does at the moment of cancelling, under the
 * same conditions: not collected, and not already ended. A run somebody collected
 * is left alone, because the food is on the road and a person has to end it.
 *
 * Touches nothing on a database with no such rows. Written against the tables
 * rather than the models, so the migration keeps meaning what it says.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('delivery_jobs')
            ->whereNull('picked_up_at')
            ->whereNotIn('status', ['delivered', 'cancelled', 'failed'])
            ->whereIn('order_id', DB::table('orders')->where('status', 'cancelled')->select('id'))
            ->update([
                'status' => 'cancelled',
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => CarbonImmutable::now(),
            ]);
    }

    public function down(): void
    {
        // Nothing to restore: which runs this closed is not recorded, and none of
        // them should reopen behind a cancelled order.
    }
};
