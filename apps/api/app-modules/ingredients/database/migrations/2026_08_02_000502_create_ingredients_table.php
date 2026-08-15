<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The ingredient master: one platform library (organisation_id NULL) that
 * every tenant reads, plus each tenant's own rows.
 *
 * **No `ingredient_kind`, no `produced_by_recipe_id`** (master plan v2 §4.2).
 * An "intermediate" is not a kind of ingredient — it is an ingredient that
 * happens to appear in some recipe version's outputs, which is a fact about
 * `recipe_version_outputs` (slice K1.2), not a column here. Storing it here
 * would need a circular foreign key, would be version-blind (yields differ per
 * version, and a version may have several outputs), and would tempt the
 * importer into fabricating a stub recipe for every intermediate that has no
 * technical sheet. The reviewer's correction is adopted: this table stays
 * ignorant of recipes, and K1.2 adds the outputs table that answers the
 * question properly.
 *
 * `forked_from_ingredient_id` records that a tenant row started life as a copy
 * of a platform row. The fork *endpoint* is a later slice; the column exists
 * now so a fork never has to be reconstructed after the fact.
 *
 * `lock_version` carries the optimistic-concurrency contract (master plan v2
 * §4.13): the single-resource GET returns it as an `ETag`, and a write without
 * a matching `If-Match` is refused.
 *
 * Isolation strategy: `org-rls` in vocabulary, app-scope in K1 — no new
 * PostgreSQL policy lands in this slice (appendix D matrix). Platform rows are
 * visible in every tenant context via `organisationScopeAllowsNull()`, the
 * pattern `roles` already uses; tenants cannot write them (policy-denied at
 * the service layer, feature-tested).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ingredients', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->nullable()->comment('null = platform library')->constrained('organisations')->cascadeOnDelete();
            $table->string('slug', 120);
            $table->string('name_en');
            $table->string('name_ar');
            $table->foreignUuid('ingredient_category_id')->nullable()->constrained('ingredient_categories')->restrictOnDelete();
            $table->foreignUuid('ingredient_subcategory_id')->nullable()->constrained('ingredient_categories')->restrictOnDelete();
            $table->foreignUuid('default_unit_id')->constrained('measurement_units')->restrictOnDelete();
            $table->decimal('yield_factor', 6, 4)->default(1)->comment('edible portion after preparation loss');
            $table->uuid('forked_from_ingredient_id')->nullable()->index();
            $table->string('availability_tier', 20)->nullable()->comment('core | common | specialty_imported');
            $table->string('status', 20)->default('active')->comment('active | inactive | archived');
            $table->string('verification_status', 20)->default('unverified')->comment('verified | unverified | requires_review');
            $table->text('notes')->nullable();
            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->index(['organisation_id', 'status']);
        });

        // Added after the table exists: an inline self-reference is emitted
        // before the primary key it points at (see the categories migration).
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->foreign('forked_from_ingredient_id')->references('id')->on('ingredients')->nullOnDelete();
        });

        DB::statement("ALTER TABLE ingredients ADD CONSTRAINT ingredients_availability_tier_check CHECK (availability_tier IS NULL OR availability_tier IN ('core', 'common', 'specialty_imported'))");
        DB::statement("ALTER TABLE ingredients ADD CONSTRAINT ingredients_status_check CHECK (status IN ('active', 'inactive', 'archived'))");
        DB::statement("ALTER TABLE ingredients ADD CONSTRAINT ingredients_verification_status_check CHECK (verification_status IN ('verified', 'unverified', 'requires_review'))");
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_yield_factor_check CHECK (yield_factor > 0)');

        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_organisation_id_slug_unique UNIQUE NULLS NOT DISTINCT (organisation_id, slug)');

        // Re-importing the same source row must converge rather than duplicate.
        //
        // Partial, not a table constraint: NULLS NOT DISTINCT is needed so the
        // platform library (organisation_id IS NULL) is covered, but applied to
        // the whole tuple it would also make every hand-created ingredient —
        // all of which have no source at all — collide with the next one. The
        // index therefore only polices rows that actually claim a source.
        DB::statement('CREATE UNIQUE INDEX ingredients_organisation_id_source_unique ON ingredients (organisation_id, source_system, source_ref) NULLS NOT DISTINCT WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredients');
    }
};
