<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('currencies', function (Blueprint $table): void {
            $table->string('code', 3)->primary()->comment('ISO 4217');
            $table->string('name_en');
            $table->string('name_ar');
            $table->unsignedSmallInteger('minor_units')->default(2);
            $table->boolean('is_active')->default(false);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('currencies');
    }
};
