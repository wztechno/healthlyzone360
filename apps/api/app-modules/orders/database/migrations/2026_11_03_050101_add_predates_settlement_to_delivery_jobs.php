<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The line under driver runs from before settlement existed.
 *
 * Without it the first settlement list holds every delivered run in the kitchen's
 * history, and the cash behind them came back by hand long ago. A rolling window
 * would be wrong: it would quietly drop a real unsettled run once it aged. So the
 * line is drawn once, here, on runs delivered more than two days before the
 * migration, which leaves the last shift or two on the list to settle.
 *
 * Driver runs only. A courier run's receipt is written by settling it, so an old
 * courier run is money the order still shows as owing, and it stays on the list.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->boolean('predates_settlement')->default(false)->comment('a driver run delivered before settlement existed; never waits for a hand-in');
        });

        DB::statement(
            "UPDATE delivery_jobs SET predates_settlement = true
             WHERE status = 'delivered'
               AND courier_name IS NULL
               AND cash_settlement_id IS NULL
               AND delivered_at < now() - interval '2 days'"
        );
    }

    public function down(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->dropColumn('predates_settlement');
        });
    }
};
