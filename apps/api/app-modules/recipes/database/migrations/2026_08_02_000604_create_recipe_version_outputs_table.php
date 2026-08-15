<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a recipe version *produces* (master plan v2 §4.2) — the table that
 * replaced `ingredients.produced_by_recipe_id` and, with it, migration 001206
 * and the fabricated-stub-recipe risk.
 *
 * Three things the dropped column could not say and this table says plainly:
 * a version may produce several things (a pesto mix and its trim); the yield
 * is a fact about the *version*, not the recipe, so it changes when the
 * formulation does; and an "intermediate" ingredient is simply one that
 * appears in some version's outputs — no kind column, no circular foreign key,
 * and no need to invent a producing recipe for an intermediate that has no
 * technical sheet.
 *
 * `UNIQUE (recipe_version_id, ingredient_id)` — one statement per produced
 * ingredient per version; a second yield for the same ingredient is an edit,
 * not another row.
 *
 * `PARTIAL UNIQUE (recipe_version_id) WHERE is_primary` — at most one primary
 * output. "The thing this recipe makes" has to be answerable without a tie
 * break, and PostgreSQL is a better place to guarantee that than a service
 * that remembers to clear the old flag.
 *
 * Isolation strategy: `join-rls-parent` — reached only through
 * `recipe_versions`, which carries the policy; cascade-deleted with it, and
 * `organisation_id` denormalised so the join is never needed to answer "whose
 * is this".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_version_outputs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();
            $table->decimal('output_quantity', 12, 4);
            $table->foreignUuid('unit_id')->constrained('measurement_units')->restrictOnDelete();
            $table->boolean('is_primary')->default(false);
            $table->timestamp('created_at')->nullable();

            $table->unique(['recipe_version_id', 'ingredient_id']);
            $table->index('ingredient_id');
        });

        DB::statement('ALTER TABLE recipe_version_outputs ADD CONSTRAINT recipe_version_outputs_output_quantity_check CHECK (output_quantity > 0)');

        DB::statement('CREATE UNIQUE INDEX recipe_version_outputs_one_primary ON recipe_version_outputs (recipe_version_id) WHERE is_primary');
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_version_outputs');
    }
};
