<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The **frozen allergen label** of one recipe version.
 *
 * This table exists because a label is a statement made at a point in time.
 * Recomputing the roll-up on every read would mean the declaration a customer
 * saw last week cannot be reconstructed, and a food-safety record that cannot
 * be reconstructed is not a record. Publication writes the derived rows here
 * and `derivation_state` on the version says whether they still match the
 * mappings underneath.
 *
 * `derivation` separates two very different claims:
 *
 * - **`derived`** — computed from the effective ingredient mappings (platform
 *   baseline ∪ this organisation's overlay), with `source_ingredient_id`
 *   naming the line that caused it. Provenance is not a nicety: "why does this
 *   dish say sesame" has to be answerable, and a chip in the UI that says
 *   "from tahini" is the difference between a warning that is trusted and one
 *   that is clicked past.
 * - **`declared`** — a human said so. A chef who knows the fryer is shared
 *   declares a `may_contain` no mapping implies.
 *
 * A derived row never overwrites a declared one with a weaker containment. A
 * kitchen's explicit `contains` outranks a computation that only found
 * `may_contain`, because the computation only knows what it was told.
 *
 * `UNIQUE (recipe_version_id, allergen_code)` — one statement per class per
 * version, whatever it was derived from. `source_ingredient_id` is
 * `nullOnDelete` rather than `restrict`: the provenance is nice to have, the
 * label is not optional, and a label row must never be the reason an
 * ingredient cannot be removed.
 *
 * Classification: **Public**. Unlike the lines, this is the one part of a
 * recipe version that is meant to reach a diner (appendix D).
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_version_allergens', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('allergen_code', 20);
            $table->string('containment', 20)->comment('contains | may_contain');
            $table->string('derivation', 20)->comment('declared | derived');
            $table->foreignUuid('source_ingredient_id')->nullable()->constrained('ingredients')->nullOnDelete();
            $table->string('source_note', 255)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->foreign('allergen_code')->references('code')->on('allergens')->restrictOnDelete();

            $table->unique(['recipe_version_id', 'allergen_code']);
        });

        DB::statement("ALTER TABLE recipe_version_allergens ADD CONSTRAINT recipe_version_allergens_containment_check CHECK (containment IN ('contains', 'may_contain'))");
        DB::statement("ALTER TABLE recipe_version_allergens ADD CONSTRAINT recipe_version_allergens_derivation_check CHECK (derivation IN ('declared', 'derived'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_version_allergens');
    }
};
