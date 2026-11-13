<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whether the food on a late cancellation came back or went in the bin.
 *
 * Null on every order cancelled before cooking started, and on every order
 * cancelled before this column existed: both restored their stock, which is what
 * null means. A plain string, like `cancellation_reason`, with the vocabulary on
 * `CancellationDisposition`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->string('cancellation_disposition', 24)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn('cancellation_disposition');
        });
    }
};
