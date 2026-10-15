<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredient_allergens', fn (Blueprint $table) => $table->jsonb('lookup_source')->nullable());
    }

    public function down(): void
    {
        Schema::table('ingredient_allergens', fn (Blueprint $table) => $table->dropColumn('lookup_source'));
    }
};
