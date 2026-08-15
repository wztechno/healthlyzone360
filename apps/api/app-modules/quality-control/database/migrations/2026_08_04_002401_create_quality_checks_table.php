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
        Schema::create('quality_checks', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('subject_type', 48);
            $table->uuid('subject_id');
            $table->string('status', 16)->default('pending');
            $table->string('notes', 255)->nullable();
            $table->timestamps();
            $table->index(['subject_type', 'subject_id']);
        });

        DB::statement("ALTER TABLE quality_checks ADD CONSTRAINT quality_checks_status_check CHECK (status IN ('pending', 'passed', 'hold', 'released'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('quality_checks');
    }
};
