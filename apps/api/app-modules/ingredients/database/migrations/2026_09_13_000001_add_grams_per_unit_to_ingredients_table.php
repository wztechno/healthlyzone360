<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What one stock unit of the article weighs, in grams.
 *
 * A recipe line states a quantity in some unit, and nutrition is stated per
 * 100 g. When the line's unit is a mass the conversion is arithmetic and
 * `UnitConversionService` does it. When it is anything else — a litre of soya
 * sauce, a piece of dough — no general conversion exists, because the answer
 * depends on the substance rather than on the units. This column is where that
 * substance-specific answer is recorded: `0.2 l × 1080 g/l = 216 g`.
 *
 * ## Stored, not derived — and deliberately not `capacity_quantity`
 *
 * The obvious objection is that `capacity_quantity`/`capacity_unit_id` already
 * express "how much of something one item holds". They do, for packaging: a
 * bottle holds 0.3 kg of *product*, which is a fact about the container and is
 * a pair of columns because the recipe's yield unit is what makes it usable.
 * This is a fact about the *material itself*, it is always grams per one
 * `default_unit`, and it exists on food rather than on containers. Overloading
 * the capacity pair would make one CHECK and one contract mean two unrelated
 * things, and would put a density on a bin liner.
 *
 * Nor is it derived. There is no formula from a name to a density; somebody
 * either looked it up or weighed it. The seed document carries 19 figures
 * (USDA household measures scaled to a litre) and a kitchen types the rest.
 *
 * ## NULL is the common and the correct answer
 *
 * 273 of the 306 platform rows are stocked by mass and need nothing here; 14
 * are stocked by the piece and are left NULL for whoever owns the scales. A
 * line whose ingredient has no density and no mass unit is *unresolvable*, and
 * the roll-up withholds the whole figure and names the line rather than
 * guessing a gram. That is the point of leaving it nullable: "nobody has
 * weighed this" has to be sayable, and it must not read as zero.
 *
 * ## Not validated against the unit's dimension
 *
 * Nothing here asserts that `default_unit_id` is a volume. A count unit is
 * just as legitimate a subject — "one piece of rkakat dough weighs 18 g" is
 * exactly the figure a kitchen should record — and a CHECK spanning two
 * columns and a lookup table would refuse that for no benefit. The only
 * invariant worth enforcing in the database is the one below: a mass of zero
 * or less is a data-entry accident every time, and a NULL is not a zero.
 *
 * ## The service clears it when the unit changes
 *
 * The figure is meaningless without the unit it counts, so
 * `IngredientCatalogueService::update()` nulls it when `default_unit_id`
 * changes and the request does not supply a replacement — relabelling a
 * per-litre mass as per-millilitre would be wrong by a factor of a thousand
 * and would look exactly like a correct row. The seeder applies the same rule
 * from the other side: it writes a density only while the row's default unit
 * is still the one the document names it against.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ingredients', function (Blueprint $table): void {
            $table->decimal('grams_per_unit', 12, 4)->nullable()
                ->comment('Mass in grams of one default_unit; NULL = unweighed, never zero');
        });

        // Zero would divide a recipe line into nothing and a negative mass is
        // not a thing. NULL stays the way to say "unknown".
        DB::statement('ALTER TABLE ingredients ADD CONSTRAINT ingredients_grams_per_unit_check CHECK (grams_per_unit IS NULL OR grams_per_unit > 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS ingredients_grams_per_unit_check');

        Schema::table('ingredients', function (Blueprint $table): void {
            $table->dropColumn('grams_per_unit');
        });
    }
};
