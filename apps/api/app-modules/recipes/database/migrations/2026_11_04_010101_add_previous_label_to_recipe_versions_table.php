<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The label a quarantined version was published with, kept so a manager can
 * compare it with the recomputed one before releasing the version.
 *
 * `{allergen class: containment}`, written by `RecomputeRecipeDerivations` at
 * the moment it quarantines and cleared by the release. Null on every version
 * that is not in review, and on the quarantines that predate this column —
 * those show their `review_reason` instead.
 *
 * Row-level security needs nothing here: the policy on `recipe_versions` is per
 * row, and a new column inherits it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->jsonb('previous_label')->nullable()
                ->comment('The published allergen label a quarantine replaced, {class: containment}; null outside review');
        });
    }

    public function down(): void
    {
        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->dropColumn('previous_label');
        });
    }
};
