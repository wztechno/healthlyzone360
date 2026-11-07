<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A sub-recipe's allergens, written onto the ingredient it produces.
 *
 * The allergen half of `nutrition_derived_from_version_id`: a published version
 * that outputs an ingredient (an in-house sauce) writes its frozen label onto
 * that ingredient's organisation layer as `recipe_derived` rows, so every dish
 * built on the sauce picks the allergens up. `RecipeOutputAllergenWriter` owns
 * every write; the mapping editor refuses to change these rows.
 *
 * - `ingredient_allergens.derived_from_version_id`: the version that wrote the
 *   row. Set exactly when `source = 'recipe_derived'`, which the CHECK holds.
 * - `ingredients.allergens_derived_from_version_id`: the version that claims the
 *   ingredient's allergens, even when its label is empty. The publish gate
 *   reads it as "determined": an empty derived label is a statement.
 *
 * No foreign keys, for the reason the nutrition column gives: Ingredients must
 * not learn that Recipes exists.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredient_allergens', function (Blueprint $table): void {
            $table->uuid('derived_from_version_id')->nullable()->index()
                ->comment('Published recipe version this row was carried from; NULL = entered, not derived');
        });

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->uuid('allergens_derived_from_version_id')->nullable()
                ->comment('Published recipe version whose label defines these allergens; NULL = not derived');
        });

        DB::statement('ALTER TABLE ingredient_allergens DROP CONSTRAINT ingredient_allergens_source_check');
        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_source_check CHECK (source IN ('master_list', 'technical_sheet', 'supplier_declaration', 'kitchen_declared', 'inferred', 'recipe_derived'))");
        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_derived_link_check CHECK ((source = 'recipe_derived') = (derived_from_version_id IS NOT NULL))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE ingredient_allergens DROP CONSTRAINT ingredient_allergens_derived_link_check');
        DB::table('ingredient_allergens')->where('source', 'recipe_derived')->delete();
        DB::statement('ALTER TABLE ingredient_allergens DROP CONSTRAINT ingredient_allergens_source_check');
        DB::statement("ALTER TABLE ingredient_allergens ADD CONSTRAINT ingredient_allergens_source_check CHECK (source IN ('master_list', 'technical_sheet', 'supplier_declaration', 'kitchen_declared', 'inferred'))");

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropColumn('allergens_derived_from_version_id');
        });

        Schema::table('ingredient_allergens', function (Blueprint $table): void {
            $table->dropColumn('derived_from_version_id');
        });
    }
};
