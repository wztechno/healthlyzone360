<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('measurement_units', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('code')->unique()->comment('e.g. g, ml, kcal, cm, kg');
            $table->string('unit_system');
            $table->string('name_en');
            $table->string('name_ar');
            $table->boolean('is_active')->default(true);
        });

        DB::statement("ALTER TABLE measurement_units ADD CONSTRAINT measurement_units_unit_system_check CHECK (unit_system IN ('metric', 'imperial', 'clinical'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('measurement_units');
    }
};
