<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * When the kitchen started cooking an order — "Start" on the kitchen display (HA-24).
 *
 * Until now confirming *was* starting: the kitchen display put every confirmed
 * order straight into "In preparation", while the customer was told it was "in
 * the queue" and never saw "Cooking" at all. Confirming now only accepts the
 * order (it waits in Incoming); Start stamps this column and moves the ticket
 * into In preparation, which is what the customer's page reads as Cooking.
 *
 * A timestamp beside the status, not a new status, for the reason `ready_at`
 * gave: cooking changes nothing the status machine guards.
 *
 * **The backfill keeps today's board where it is.** Orders confirmed before this
 * runs and not yet ready are on the board under the old meaning — confirmed was
 * started — so they are stamped as started when they were confirmed, and stay
 * in In preparation instead of jumping back to Incoming. Nothing else is
 * backfilled: a finished order's cooking time was never recorded, and it is not
 * invented here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->timestamp('preparing_at')->nullable()->after('confirmed_at');
        });

        DB::table('orders')
            ->where('status', 'confirmed')
            ->whereNull('ready_at')
            ->update(['preparing_at' => DB::raw('confirmed_at')]);
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn('preparing_at');
        });
    }
};
