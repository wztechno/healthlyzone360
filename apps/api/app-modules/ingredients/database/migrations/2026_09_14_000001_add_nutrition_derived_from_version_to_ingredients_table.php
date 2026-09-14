<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which published recipe version, if any, defines this ingredient's per-100 g
 * facts.
 *
 * A sub-recipe produces something a later formulation consumes — a pesto mix
 * that a pesto mayonnaise is built on — and that intermediate is an ordinary
 * row in `ingredients`, named by a `recipe_version_outputs` row. Its nutrition
 * is not reference data anybody looks up: it is whatever the recipe that makes
 * it works out to, per 100 g of its finished mass. So it is derived, at publish
 * and on every recompute, and this column records the version that derived it.
 *
 * ## What the link is for
 *
 * Two things, and nothing else. It marks the facts as **read-only to the
 * catalogue** — a figure a human typed over a derivation would be silently
 * overwritten by the next recompute, and, worse, would disagree with the recipe
 * that defines the thing. And it says **whose** figure it is, so that retiring
 * the version that owns it clears it rather than leaving a number standing
 * behind a formulation that is no longer published.
 *
 * ## No foreign key, deliberately
 *
 * `recipe_versions` lives in the Recipes module and Ingredients must not learn
 * that Recipes exists — the dependency edge runs Recipes → Ingredients, one
 * way, and every cross-module question already goes through a port
 * (`IngredientUsageRegistry`) rather than a join. A constraint here would
 * invert that edge in the schema, which is the one place it cannot be argued
 * with later.
 *
 * The cost of not having one is a dangling identifier if a version row is ever
 * hard-deleted, and that is affordable: versions are retired, never deleted,
 * and a dangling link reads as "derived by something that is gone", which is
 * the same answer a `ON DELETE SET NULL` would give a moment later. The index
 * is what the clearing path needs; it is not a constraint.
 *
 * **The recipes module owns the write.** `RecipeOutputNutritionWriter` is the
 * only thing that sets or clears this column and the facts beside it;
 * `IngredientCatalogueService::update()` refuses both fields while it is set.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->uuid('nutrition_derived_from_version_id')->nullable()->index()
                ->comment('Published recipe version these facts were derived from; NULL = entered, not derived');
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropColumn('nutrition_derived_from_version_id');
        });
    }
};
