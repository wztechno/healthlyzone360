<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two limits each kitchen sets for itself, as whole percentages. Both start empty:
 * there is no ruling on either number, and a default would hold up a kitchen's
 * invoices or alert its owner on a figure nobody chose. Empty means the check is off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->unsignedSmallInteger('price_approval_above_percent')->nullable()->comment('a delivery priced this far above the last price needs approval; null turns approvals off');
            $table->unsignedSmallInteger('dish_margin_target_percent')->nullable()->comment('the margin a dish should clear; null turns the alert off');
        });
    }

    public function down(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->dropColumn(['price_approval_above_percent', 'dish_margin_target_percent']);
        });
    }
};
