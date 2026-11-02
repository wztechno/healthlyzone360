<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the kitchen must know about who is eating this order.
 *
 * The audit proved a customer's anaphylaxis note stopped at their profile: the
 * order carried nothing, so the cook, the desk and the driver never saw it.
 *
 *  * `allergy_snapshot` — every allergy declared at placement, with its severity
 *    and notes and the lines it conflicts with. Null when nothing was declared.
 *    A copy for the reason the address is one: a profile edited tomorrow must
 *    not change what today's order was cooked against.
 *  * `allergy_note` — free text taken at the desk, which is how a walk-in with no
 *    profile is covered.
 *  * `allergy_acknowledged_at` / `_by` — a conflict was seen and the order went
 *    ahead anyway. `_by` is the cashier, null when the customer acknowledged it.
 *
 * Health data: `OrderSnapshotRedaction` clears all four when an account closes.
 * Nothing is backfilled, because a past order's declarations were never recorded
 * and today's profile is not what those orders were cooked against.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->jsonb('allergy_snapshot')->nullable();
            $table->text('allergy_note')->nullable();
            $table->timestamp('allergy_acknowledged_at')->nullable();
            $table->foreignUuid('allergy_acknowledged_by')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('allergy_acknowledged_by');
            $table->dropColumn(['allergy_snapshot', 'allergy_note', 'allergy_acknowledged_at']);
        });
    }
};
