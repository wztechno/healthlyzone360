<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A recipe — the stable identity a kitchen names, searches for and links to.
 * Everything that can change (lines, yields, steps, costs, the allergen label)
 * belongs to a *version*, never here.
 *
 * **No `current_version_id`.** The obvious column is a lie waiting to happen:
 * it duplicates a fact the versions already know, and the two disagree the
 * first time a publish half-succeeds. The partial unique index on
 * `recipe_versions (recipe_id) WHERE status = 'published'` is the mechanism
 * instead — at most one published version per recipe, enforced by PostgreSQL
 * rather than by a service remembering to keep a pointer in step.
 *
 * `recipe_category` is a plain varchar with **no** CHECK constraint, which is a
 * deliberate departure from the house style. The source vocabulary
 * (sauce, dressing, marination, patty, topping, component) is a description of
 * how one kitchen organises its sheets, not a regulated identity; a CHECK
 * would turn "we started making dips" into a migration. Contrast
 * `confidentiality` and `status`, which are invariants the code branches on
 * and are constrained.
 *
 * `confidentiality` defaults to `confidential`, not `internal`: a formulation
 * is the kitchen's commercial secret unless somebody decides otherwise, and a
 * default that leaks is a default that is wrong once.
 *
 * Isolation strategy: `org-rls`. Unlike K1.1 there is no platform library here
 * — a recipe always belongs to exactly one organisation — so `organisation_id`
 * is NOT NULL and the scope has no NULL case to allow.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('organisation_branches')->nullOnDelete();
            $table->string('slug', 120);
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('recipe_category', 40)->nullable()->comment('sauce | dressing | marination | patty | topping | component — free text by design, see the migration docblock');
            $table->string('source_kind', 40)->nullable()->comment('the source sheet Kind, verbatim: Production | Supplier | both');
            $table->string('confidentiality', 20)->default('confidential')->comment('internal | confidential');
            $table->string('status', 20)->default('active')->comment('active | archived');
            $table->text('notes')->nullable();
            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'slug']);
            $table->index(['organisation_id', 'status']);
        });

        DB::statement("ALTER TABLE recipes ADD CONSTRAINT recipes_confidentiality_check CHECK (confidentiality IN ('internal', 'confidential'))");
        DB::statement("ALTER TABLE recipes ADD CONSTRAINT recipes_status_check CHECK (status IN ('active', 'archived'))");

        // Re-importing the same source sheet must converge rather than
        // duplicate. Partial, and for the same reason as `ingredients`: applied
        // to the whole tuple it would make every hand-created recipe — none of
        // which claims a source — collide with the next one.
        DB::statement('CREATE UNIQUE INDEX recipes_organisation_id_source_unique ON recipes (organisation_id, source_system, source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('recipes');
    }
};
