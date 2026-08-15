<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The raw-material lines of one recipe version — the formulation itself, and
 * the most confidential thing in the catalogue.
 *
 * **No unique key on (version, ingredient).** Duplicate ingredient lines are
 * legitimate and common: a sheet that adds olive oil to the marinade and again
 * to the finish is two lines, and merging them would rewrite the method. Line
 * identity is `(recipe_version_id, line_number)`.
 *
 * `ingredient_id` is `restrictOnDelete` (appendix D, OD-8): an ingredient that
 * appears in a formulation is part of a food-safety record and cannot be
 * deleted out from under it. `IngredientCatalogueService::archive()` carries
 * the same rule one level up, refusing to archive an ingredient a non-retired
 * version still references.
 *
 * `quantity` is nullable, and legally so only while the version is a draft (or
 * quarantined): the sauces-and-dressings source lists typical ingredients with
 * no amounts at all, and refusing to store that would mean either fabricating
 * numbers or losing the formulation. The publish gate is where nullability
 * ends — a version with an unquantified line cannot be published.
 *
 * **Costs are major-unit decimals** (master plan v2 §4.4). The columns are
 * named `*_amount`, never `*_minor`: `3.9` on a technical sheet is three
 * dollars ninety, and calling it "minor units" was the terminology error the
 * reviewer corrected. Prices — a different concept, on a different table, in a
 * later slice — stay `amount_minor` integers.
 *
 * The cost columns exist here and are written by nothing in K1.2: no presenter
 * exposes them, no endpoint accepts them. The cost surface and its permission
 * split (`recipe.view_costs_organisation`) are K1.3. They are migrated now
 * because the importer writes a costed version in one pass, and a formulation
 * imported without its costs would have to be re-imported to gain them.
 *
 * Isolation strategy: `org-rls` — this table carries a PostgreSQL policy of
 * its own (see the row-level-security migration in this group), because a
 * formulation leak is the worst failure this schema can have.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_version_lines', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->integer('line_number');
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();
            $table->decimal('quantity', 12, 4)->nullable()->comment('null is legal only while the version is unpublished');
            $table->foreignUuid('unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();

            $table->decimal('unit_cost_amount', 18, 6)->nullable()->comment('major currency units (§4.4), never minor');
            $table->decimal('line_cost_amount', 18, 6)->nullable()->comment('major currency units (§4.4), never minor');
            $table->string('cost_currency_code', 3)->nullable();

            $table->string('source_designation', 160)->nullable()->comment('the import source wording, verbatim');
            $table->string('comment', 255)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('cost_currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique(['recipe_version_id', 'line_number']);
            $table->index('ingredient_id');
        });

        DB::statement('ALTER TABLE recipe_version_lines ADD CONSTRAINT recipe_version_lines_line_number_check CHECK (line_number > 0)');
        DB::statement('ALTER TABLE recipe_version_lines ADD CONSTRAINT recipe_version_lines_quantity_check CHECK (quantity IS NULL OR quantity > 0)');

        // A monetary value without its currency is not a monetary value
        // (master plan v2 §4.4): every cost amount carries exactly one.
        DB::statement('ALTER TABLE recipe_version_lines ADD CONSTRAINT recipe_version_lines_cost_currency_check CHECK ((unit_cost_amount IS NULL AND line_cost_amount IS NULL) OR cost_currency_code IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_version_lines');
    }
};
