<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who cancelled an order.
 *
 * Null when nobody did by hand: a system job, and every order cancelled
 * before this column existed. `nullOnDelete`, because a cancellation is
 * still a cancellation after the person who made it leaves.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->foreignUuid('cancelled_by')->nullable()->comment('the user who cancelled it; null for a system cancel')->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('cancelled_by');
        });
    }
};
