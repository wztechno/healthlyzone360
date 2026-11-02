<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A new kitchen is set up before it takes orders; `KitchenProvisioning` sets this
 * and going live clears it.
 *
 * False by default, and that default is the whole migration's promise: every
 * kitchen trading today, with a row or without one, stays open.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->boolean('not_open_yet')->default(false)->comment('new customer orders are refused until the kitchen goes live');
        });
    }

    public function down(): void
    {
        Schema::table('kitchen_service_settings', function (Blueprint $table): void {
            $table->dropColumn('not_open_yet');
        });
    }
};
