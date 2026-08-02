<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which allergen classes an ingredient carries — the food-safety join.
 *
 * Two layers live in one table, separated by `organisation_id`:
 *
 * - **NULL — the platform baseline.** What the reference data says about the
 *   platform ingredient library. Kitchens read it; kitchens never write it.
 * - **A tenant identifier — that kitchen's overlay.** What the kitchen knows
 *   about its own supply: a supplier declaration, a technical sheet, a
 *   may-contain warning from a shared production line.
 *
 * The overlay is **upgrade-only** (master plan v2 §4.6, appendix D): a kitchen
 * may add a `contains` where the baseline says `may_contain` or says nothing,
 * because knowing more about your own supply is normal. A kitchen may never
 * remove or weaken a baseline row, because "the platform says milk, my
 * overlay says nothing" is exactly the failure mode that puts a milk allergen
 * on a plate. The invariant is enforced in `AllergenMappingService` and
 * proven by test; the schema keeps both layers addressable so it can be.
 *
 * `market_scope` exists because EU-14 and US Big-9 are different lists:
 * coconut is a tree nut in the United States and not an allergen in the EU,
 * so one ingredient legitimately carries a `us_only` row and no EU row.
 *
 * `allergen_code` is `restrictOnDelete`: an allergen class in use cannot be
 * deleted, which is a second lock on top of the "deactivate, never delete"
 * rule the class table already states.
 *
 * This migration lives with the allergens module because the two allergen
 * tables are one schema story; the `IngredientAllergen` model lives with the
 * ingredients module, whose services own every write to it (a module may not
 * depend on one that depends on it).
 *
 * Isolation strategy: `join-rls-parent` in vocabulary — app-scope in K1, no
 * new PostgreSQL policy in this slice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ingredient_allergens', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->cascadeOnDelete();
            $table->string('allergen_code', 20);
            $table->foreignUuid('organisation_id')->nullable()->comment('null = platform baseline')->constrained('organisations')->cascadeOnDelete();
            $table->string('containment', 20)->comment('contains | may_contain');
            $table->string('market_scope', 20)->default('all')->comment('all | us_only | eu_only');
            $table->string('source', 40)->comment('master_list | technical_sheet | supplier_declaration | kitchen_declared | inferred');
            $table->string('verification_status', 40)->comment('verified | unverified | requires_review | requires_supplier_confirmation');
            $table->text('evidence')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('allergen_code')->references('code')->on('allergens')->restrictOnDelete();
        });

        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_containment_check CHECK (containment IN ('contains', 'may_contain'))");
        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_market_scope_check CHECK (market_scope IN ('all', 'us_only', 'eu_only'))");
        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_source_check CHECK (source IN ('master_list', 'technical_sheet', 'supplier_declaration', 'kitchen_declared', 'inferred'))");
        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_verification_status_check CHECK (verification_status IN ('verified', 'unverified', 'requires_review', 'requires_supplier_confirmation'))");

        DB::statement('ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_unique UNIQUE NULLS NOT DISTINCT (ingredient_id, allergen_code, market_scope, organisation_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('ingredient_allergens');
    }
};
