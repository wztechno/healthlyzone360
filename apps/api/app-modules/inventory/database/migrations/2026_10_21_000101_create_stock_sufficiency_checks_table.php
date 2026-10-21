<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The weekly stock check (2026-10-21): what one branch was short of, for the
 * week ahead, as it stood when the scheduler looked.
 *
 * The buy list (`RequirementForecast`) has always been answerable on demand,
 * but nobody was told when it turned red — a kitchen found out it had no
 * chicken for Thursday's corporate order on Thursday. The weekly run writes
 * one row per branch per run, so the requirements screen can say "Monday's
 * check found 3 items short" and a run nobody looked at is still on record.
 *
 * `shortfalls` is a snapshot, deliberately: the live forecast keeps moving as
 * orders arrive, and a record of what the check saw is what makes it a check.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_sufficiency_checks', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();

            $table->date('window_from');
            $table->date('window_to');
            $table->timestamp('checked_at');

            $table->integer('requirement_count')->comment('stock items the window needs at all');
            $table->integer('short_count')->comment('of those, how many the shelf cannot cover');
            $table->integer('not_computable_days')->comment('days with demand nobody could work out — a missing recipe, an unwritten menu');
            $table->jsonb('shortfalls')->comment('the short rows as the forecast published them, a snapshot');

            $table->timestamps();

            // The screen's read: this branch's latest check.
            $table->index(['branch_id', 'checked_at']);
        });

        DB::statement('ALTER TABLE stock_sufficiency_checks ADD CONSTRAINT stock_sufficiency_checks_window_check CHECK (window_to >= window_from)');
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_sufficiency_checks');
    }
};
