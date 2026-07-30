<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('feature_definitions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('code')->unique()->comment('e.g. feature.two_factor_enforcement');
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('description');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feature_definitions');
    }
};
