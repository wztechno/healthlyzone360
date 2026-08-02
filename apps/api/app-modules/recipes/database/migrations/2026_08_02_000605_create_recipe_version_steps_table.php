<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The method of one recipe version, one instruction per row.
 *
 * Separate rows rather than a single block of prose because a step is
 * addressable: a production screen highlights the current one, a translation
 * is reviewed per step, and `minutes` is a number a scheduler can add up.
 *
 * `instruction_ar` is nullable while `instruction_en` is not — a kitchen
 * writes the method it works in first, and blocking a draft on a translation
 * that nobody has written yet would only produce machine translation, which
 * the master plan forbids for anything a person acts on (§4.18).
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_version_steps', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->integer('step_number');
            $table->text('instruction_en');
            $table->text('instruction_ar')->nullable();
            $table->integer('minutes')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['recipe_version_id', 'step_number']);
        });

        DB::statement('ALTER TABLE recipe_version_steps ADD CONSTRAINT recipe_version_steps_step_number_check CHECK (step_number > 0)');
        DB::statement('ALTER TABLE recipe_version_steps ADD CONSTRAINT recipe_version_steps_minutes_check CHECK (minutes IS NULL OR minutes >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_version_steps');
    }
};
