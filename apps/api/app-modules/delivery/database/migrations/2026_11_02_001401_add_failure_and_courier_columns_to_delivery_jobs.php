<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How a run ended when it did not end at the door, and who carried it when nobody
 * on the kitchen's own sheet did.
 *
 *  * `failed_at`, `failure_reason`, `failure_note` — written when a run comes
 *    back. `status` has always allowed `failed`; nothing wrote it until now.
 *  * `courier_name`, `courier_reference`, `courier_fee_minor` — a courier company
 *    took the order. No driver, so it never reaches a run sheet. The fee is held
 *    for batch settlement in Stage 3.
 *
 * All cleared by a re-deliver, because the run starts again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->timestamp('failed_at')->nullable();
            $table->string('failure_reason', 24)->nullable();
            $table->text('failure_note')->nullable();
            $table->string('courier_name', 120)->nullable();
            $table->string('courier_reference', 120)->nullable();
            $table->bigInteger('courier_fee_minor')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->dropColumn(['failed_at', 'failure_reason', 'failure_note', 'courier_name', 'courier_reference', 'courier_fee_minor']);
        });
    }
};
