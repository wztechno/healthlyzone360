<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The two brakes a kitchen pulls during service.
 *
 * `orders_per_window` is the most orders one delivery window takes on one day;
 * null, the default, means the kitchen has set no limit. One number for the
 * kitchen rather than one per window, because that is what a kitchen knows at
 * first and a per-window figure can land on `delivery_windows` when one asks.
 *
 * `paused_until` refuses new customer orders until that instant. It ends by the
 * clock passing it, so nothing has to run for a kitchen to come back, and a pause
 * nobody remembered cannot outlive its own timer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->integer('orders_per_window')->nullable()->comment('most orders per window and day; null means no limit');
            $table->timestampTz('paused_until')->nullable()->comment('new customer orders are refused until this instant');
            $table->foreignUuid('paused_by')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('paused_by');
            $table->dropColumn(['orders_per_window', 'paused_until']);
        });
    }
};
