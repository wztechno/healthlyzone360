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
        Schema::create('roles', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->nullable()->comment('null = platform template')->constrained('organisations')->cascadeOnDelete();
            $table->string('code');
            $table->string('name_en');
            $table->string('name_ar');
            $table->boolean('is_system')->default(false)->comment('platform-defined, not editable');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // NULLS NOT DISTINCT (PostgreSQL 15+) so platform template roles
        // (organisation_id IS NULL) cannot duplicate a code either.
        DB::statement('ALTER TABLE roles ADD CONSTRAINT roles_organisation_id_code_unique UNIQUE NULLS NOT DISTINCT (organisation_id, code)');
    }

    public function down(): void
    {
        Schema::dropIfExists('roles');
    }
};
