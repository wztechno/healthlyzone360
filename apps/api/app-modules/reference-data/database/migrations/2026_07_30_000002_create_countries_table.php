<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('countries', function (Blueprint $table): void {
            $table->string('code', 2)->primary()->comment('ISO 3166-1 alpha-2');
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('default_currency_code', 3)->nullable();
            $table->boolean('is_active')->default(false)->comment('true only for launch markets');

            $table->foreign('default_currency_code')->references('code')->on('currencies');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('countries');
    }
};
