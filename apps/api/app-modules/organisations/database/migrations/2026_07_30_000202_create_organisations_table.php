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
        Schema::create('organisations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_type_id')->index()->constrained('organisation_types');
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('country_code', 2);
            $table->string('default_currency_code', 3);
            $table->string('default_language_code', 2);
            $table->string('status', 20)->default('pending');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('country_code')->references('code')->on('countries');
            $table->foreign('default_currency_code')->references('code')->on('currencies');
            $table->foreign('default_language_code')->references('code')->on('languages');
        });

        DB::statement("ALTER TABLE organisations ADD CONSTRAINT organisations_status_check CHECK (status IN ('active', 'suspended', 'pending'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('organisations');
    }
};
