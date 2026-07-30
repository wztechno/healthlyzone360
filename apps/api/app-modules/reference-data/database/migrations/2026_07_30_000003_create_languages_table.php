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
        Schema::create('languages', function (Blueprint $table): void {
            $table->string('code', 2)->primary()->comment('ISO 639-1');
            $table->string('name_en');
            $table->string('name_native');
            $table->string('direction', 3)->default('ltr');
            $table->boolean('is_active')->default(false);
        });

        DB::statement("ALTER TABLE languages ADD CONSTRAINT languages_direction_check CHECK (direction IN ('ltr', 'rtl'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('languages');
    }
};
