<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether placing this order took portions off the kitchen's calendar.
 *
 * Cancelling gives back only what was taken. Subscription days, accepted
 * quotations and every order placed before this column existed took nothing, so
 * giving portions back for them would invent stock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->boolean('portions_counted')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn('portions_counted');
        });
    }
};
