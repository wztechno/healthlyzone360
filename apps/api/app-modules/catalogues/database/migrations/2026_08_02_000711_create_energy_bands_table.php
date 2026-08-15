<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The calorie bracket a subscription plan variant is portioned to —
 * "1200–1500 kcal", "1500–1800 kcal".
 *
 * A **band, not a target**. The source kitchens sell brackets, and a bracket is
 * an honest statement about portioning; a single number would imply a
 * per-customer energy calculation this programme does not do and will not
 * fabricate (master plan §2.4). Anything genuinely per-person is N1's
 * nutrition work, behind its own gate.
 *
 * `CHECK (max_kcal > min_kcal)` is strict rather than `>=`: a band whose ends
 * meet is a single value wearing a range's clothes, and the day a kitchen
 * really wants one it should say so as a product decision rather than by
 * typing the same number twice.
 *
 * Nullable on the variant, deliberately — see `plan_variant_profiles`. A
 * kitchen that does not band by energy has plans with no band, which is not
 * the same as a band nobody filled in.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.6**.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('energy_bands', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->integer('min_kcal');
            $table->integer('max_kcal');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'is_active']);
        });

        DB::statement('ALTER TABLE energy_bands ADD CONSTRAINT energy_bands_min_kcal_check CHECK (min_kcal >= 0)');
        DB::statement('ALTER TABLE energy_bands ADD CONSTRAINT energy_bands_range_check CHECK (max_kcal > min_kcal)');
    }

    public function down(): void
    {
        Schema::dropIfExists('energy_bands');
    }
};
