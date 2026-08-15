<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which negotiated terms governed a corporate buyer's order.
 *
 * Not a payment column — these are commercial provenance references so a
 * reconciliation can read which agreement and tariff priced the basket.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->foreignUuid('b2b_agreement_id')->nullable()->after('sales_channel_id')
                ->constrained('b2b_agreements')->nullOnDelete();
            $table->foreignUuid('price_list_id')->nullable()->after('b2b_agreement_id')
                ->comment('the agreement tariff that priced the order; null for consumer orders')
                ->constrained('price_lists')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('price_list_id');
            $table->dropConstrainedForeignId('b2b_agreement_id');
        });
    }
};
