<?php

declare(strict_types=1);

use Healthy360\Ingredients\Services\IngredientNutritionImporter;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How good the per-100 g figures beside these columns are, and what the source
 * said about them.
 *
 * ## Why the flag has to leave the file
 *
 * `platform-ingredient-nutrition.json` marks 56 of its 306 rows `estimated`,
 * and its own notice says what to do about them: *"For purchasing, labelling or
 * medical dietetics, replace an estimated row with the supplier's own label."*
 * That is an instruction to a kitchen, and until now the only place it was
 * written down was a JSON file no kitchen can open. The seeder counted the 56
 * and printed the number; nothing carried *which* 56, so nothing on any screen
 * could tell a cook that the tempura mix's 350 kcal is a family figure for dry
 * batter mixes and the baking powder's 53 is not.
 *
 * Provenance that cannot be acted on is provenance that is not kept. So the
 * flag and the sentence beside it land on the row, reach the API, and are what
 * the ingredient screens badge.
 *
 * ## Three states, not two
 *
 * - `NULL` — nobody has said. Every tenant row typed in before this column
 *   existed, and every row the reference document has nothing to say about.
 * - `true` — a representative or estimated figure. Recipe-, brand-, salt- or
 *   preparation-dependent; true of the *category* rather than measured of the
 *   thing in the store cupboard.
 * - `false` — a declared figure. Somebody stated it about this ingredient: a
 *   supplier's label, or a kitchen typing in what the packet says.
 *
 * A two-state boolean would have to pick a default for the unknown, and both
 * choices are a claim: `false` says "declared" of 306 rows nobody declared, and
 * `true` says "estimated" of a label transcribed off a packet. Nullable is the
 * only honest shape, and it matches `waste_percent` and `grams_per_unit`, where
 * the same distinction is already drawn.
 *
 * ## The note is the source's sentence, not a comment field
 *
 * 300 characters because the document's longest is 58 and the width is there
 * for a supplier's own wording later, not for a paragraph. `notes` on the same
 * table is the kitchen's free-text scratchpad about the *ingredient*; this one
 * is about the *figures*, which is why it is not that column: replacing the
 * facts has to be able to replace the sentence that describes them without
 * touching anything a cook wrote.
 *
 * ## Not in the seed fingerprint
 *
 * `nutrition_seed_fingerprint` stays a hash of `[nutrition_per_100g,
 * grams_per_unit]`. See {@see IngredientNutritionImporter::fingerprint()}
 * for the reasoning; in short, the fingerprint answers "are these *figures*
 * still the ones we seeded", and a note somebody reworded is not a figure
 * anybody curated.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->boolean('nutrition_estimated')->nullable()
                ->comment('true = a representative/estimated figure, false = a declared one, NULL = nobody has said');
            $table->string('nutrition_note', 300)->nullable()
                ->comment('What the source said about the figures — a basis, a caveat, a brand. Not the kitchen notes column.');
        });
    }

    public function down(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropColumn(['nutrition_estimated', 'nutrition_note']);
        });
    }
};
