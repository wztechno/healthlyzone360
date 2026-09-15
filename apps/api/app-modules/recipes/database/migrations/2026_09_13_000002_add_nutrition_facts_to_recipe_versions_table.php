<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The nutrition a version's own lines add up to, per whole recipe.
 *
 * `RecipeNutritionService::forVersion()` weighs every line in grams, scales
 * each ingredient's per-100 g reference facts by that weight and sums them.
 * Publication writes the answer here; so does every recompute.
 *
 * ## A snapshot refreshed on recomputation, not an immutable fact
 *
 * The distinction decides everything else about this column. A frozen label is
 * only as true as the reference facts it was computed from, and those move: a
 * supplier restates a product's energy, an operator fills in the density that
 * lets a litre line be weighed at all, a figure was simply typed wrong. When
 * any of that happens `IngredientDerivationInvalidator` marks every dependent
 * published version stale and `RecomputeRecipeDerivations` rewrites this column
 * — including rewriting it to NULL when an ingredient has *lost* its facts,
 * which is the whole reason the job writes unconditionally rather than only
 * when it has something to say. A stale number that still looks current is the
 * failure mode; an empty one that says "withheld" is not.
 *
 * What is genuinely frozen at publication lives elsewhere: the allergen rows
 * and `derived_input_hash` record what was promised, and the cost snapshots are
 * an append-only ledger. This is the derived figure, kept honest.
 *
 * ## On the version, never on the catalogue item
 *
 * `DerivedAllergenService.php:34-41` states the rule this follows: nothing
 * derived is stored on `catalogue_items`, because a stored copy goes stale the
 * moment an input changes and nothing on that table is watching the inputs. A
 * version-level derivation already has a job whose job is exactly that
 * watching, so this is the one layer where a stored copy can be kept honest.
 * The customer's per-serving figures are projected from here on read (B5);
 * `catalogue_items.nutrition_facts` stays what it has always been — the slot a
 * kitchen or a lab writes an authoritative override into, which wins.
 *
 * ## jsonb, and no CHECK on its shape
 *
 * `jsonb` rather than `json` for the same reason every other document column in
 * this schema is: it is stored parsed, so a later `->>` or a GIN index over a
 * nutrient is available without reparsing every row.
 *
 * There is deliberately no CHECK constraint on the shape. The envelope's rules
 * are not shallow — seven required nutrients each in one canonical unit, no
 * duplicates, `saturated_fat` present only when every contributing line carried
 * it, a mass basis that names which of two things it measured — and they live
 * in `RecipeNutritionService`, which is the only writer. A jsonb constraint
 * could express perhaps a third of that, so it would be a second, weaker copy
 * of a contract that already exists: strong enough to need maintaining, too
 * weak to be relied on, and guaranteed to disagree with the service the first
 * time the envelope gains a field. The trust boundary for these numbers is the
 * ingredient validator at the far end (`StoreIngredientRequest::nutritionRules`)
 * and the service's own completeness check; this column is downstream of both.
 *
 * ## Precision: six places here, three on the wire
 *
 * The service computes at twelve places and rounds once. What is stored here is
 * rounded to six (`SNAPSHOT_SCALE`), because this figure is divided again — by
 * a piece count and a portion factor — before a customer sees it, and rounding
 * to transport precision first would bake that error into every serving. Every
 * payload that crosses the wire is rounded to three (`TRANSPORT_SCALE`), which
 * is already one more than any label displays.
 *
 * NULL is a real and common value: one line nobody could weigh, or one
 * ingredient with no facts, withholds the whole figure rather than publishing a
 * total short by exactly the thing that was missing.
 *
 * Row-level security needs nothing here — the policy on `recipe_versions` is
 * per row, over `organisation_id`, and a new column inherits it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->jsonb('nutrition_facts')->nullable()
                ->comment('Per-recipe nutrition snapshot at six places, refreshed on recomputation; null when a line could not be resolved');
        });
    }

    public function down(): void
    {
        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->dropColumn('nutrition_facts');
        });
    }
};
