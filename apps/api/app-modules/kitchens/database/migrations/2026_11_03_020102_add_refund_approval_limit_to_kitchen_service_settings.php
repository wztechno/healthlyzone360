<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Above this, a refund waits for the owner. A default rather than none, unlike the
 * timings beside it, because this column joins rows that already exist: the model
 * states the same figure for a row created from here on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->bigInteger('refund_approval_above_minor')->default(5000)
                ->comment('refunds on one order above this, in minor units, need the owner');
        });
    }

    public function down(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->dropColumn('refund_approval_above_minor');
        });
    }
};
