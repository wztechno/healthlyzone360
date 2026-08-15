<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A version of a recipe — the unit that is edited, reviewed, published and
 * frozen.
 *
 * **`review_required` is a stored state, inside the CHECK** (master plan v2
 * §4.7). The reviewer's correction was adopted in full: a critical allergen
 * contradiction must *quarantine* a version, not decorate it with a warning
 * flag that a publish path can forget to read. A version in
 * `review_required` is still editable — the whole point is that somebody
 * fixes it — but it can no more be published than a draft can skip a gate.
 * "Publishable" is never stored; it is the readiness evaluator's verdict,
 * computed at the moment of publication.
 *
 * **At most one published version per recipe**, enforced by a partial unique
 * index rather than by a `recipes.current_version_id` pointer. Publishing
 * demotes the incumbent to `retired` inside the same transaction, so the
 * index is what makes "two live versions" unrepresentable rather than merely
 * unlikely.
 *
 * `derivation_state` describes the frozen allergen label rather than the
 * recipe: `current` means the label was computed from the mappings as they
 * are, `stale` means a mapping has changed underneath it, `failed` means a
 * recompute could not complete. A new draft starts `stale` because nothing
 * has been derived for it yet — the honest state, not `current`.
 * `derived_input_hash` is a sha256 over the ordered line tuples and their
 * effective allergen sets, so an identical republish produces an identical
 * hash and a changed input cannot masquerade as an unchanged one.
 *
 * `waste_coefficient_percent` defaults to 3.00: the source technical sheets
 * apply a flat +3 % across the board, and a default that matches the data
 * beats a zero that quietly under-states every yield.
 *
 * `organisation_id` is denormalised from the parent so this table can carry a
 * row-level-security policy of its own (§4.12 `org-rls`) without every policy
 * evaluation needing a join.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_versions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_id')->constrained('recipes')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->integer('version_number');
            $table->string('status', 20)->default('draft')->comment('draft | review_required | published | retired');
            $table->string('completeness', 20)->default('indicative')->comment('indicative | costed');

            $table->decimal('yield_quantity', 12, 4)->nullable();
            $table->foreignUuid('yield_unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();
            $table->integer('yield_piece_count')->nullable();
            $table->decimal('input_quantity_total', 12, 4)->nullable()->comment('sum of the input lines, kept alongside the yield: the source sheets state both and they legitimately differ');
            $table->decimal('waste_coefficient_percent', 5, 2)->default(3.00);

            $table->string('derivation_state', 20)->default('stale')->comment('current | stale | failed');
            $table->timestamp('derived_at')->nullable();
            $table->char('derived_input_hash', 64)->nullable();

            $table->timestamp('published_at')->nullable();
            $table->foreignUuid('published_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('review_reason', 200)->nullable()->comment('why this version is quarantined');
            $table->text('notes')->nullable();

            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['recipe_id', 'version_number']);
            $table->index(['organisation_id', 'status']);
        });

        DB::statement("ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_status_check CHECK (status IN ('draft', 'review_required', 'published', 'retired'))");
        DB::statement("ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_completeness_check CHECK (completeness IN ('indicative', 'costed'))");
        DB::statement("ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_derivation_state_check CHECK (derivation_state IN ('current', 'stale', 'failed'))");
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_version_number_check CHECK (version_number > 0)');
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_yield_quantity_check CHECK (yield_quantity IS NULL OR yield_quantity > 0)');
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_yield_piece_count_check CHECK (yield_piece_count IS NULL OR yield_piece_count > 0)');
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_waste_coefficient_percent_check CHECK (waste_coefficient_percent >= 0)');

        // The mechanism that replaces `recipes.current_version_id`.
        DB::statement("CREATE UNIQUE INDEX recipe_versions_one_published_per_recipe ON recipe_versions (recipe_id) WHERE status = 'published'");

        DB::statement('CREATE UNIQUE INDEX recipe_versions_organisation_id_source_unique ON recipe_versions (organisation_id, source_system, source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_versions');
    }
};
