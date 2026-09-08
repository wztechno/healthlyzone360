<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What a version's output goes out in, and what that costs.
 *
 * The second half of a technical sheet's cost block. The source workbook runs
 * two identical tables down one page — raw materials, then packaging — each
 * summing `quantity × unit price` and each dividing its total by the *same*
 * yield. This table is the second of those, and it is separate from
 * `recipe_version_lines` for the reason `packaging_items` is separate from
 * `ingredients`: a bottle is not a raw material. It declares no allergens,
 * carries no nutrition, contributes nothing to the rollup and must never
 * appear in the picker a chef opens to build a formulation.
 *
 * ## The quantity is derived, not typed — for two of the three bases
 *
 * A hand-typed bottle count is wrong the moment the yield changes, and nothing
 * tells anybody. So `basis` says where the number comes from and the service
 * computes it:
 *
 * - `fills_yield` — `ceil(yield / capacity)`. Six 0.3 kg bottles for a 1.7 kg
 *   batch, and nine when somebody scales the batch to 2.5 kg.
 * - `per_container` — the container count above. A cap is one per bottle, so
 *   it follows the bottles rather than restating them.
 * - `per_batch` — typed, and the escape hatch. A shipping carton, a roll of
 *   film, anything consumed once per run regardless of how much came out.
 *
 * `quantity` is stored rather than recomputed on read, and that is deliberate:
 * a technical sheet is a document, and a document whose numbers change when
 * you open it is not one. The service rewrites the derived rows whenever the
 * inputs move, which is what keeps the stored figure honest.
 *
 * `ceil` and not a rounding: two thirds of a bottle does not hold anything.
 * The half-empty last container is real waste and the waste coefficient is
 * where it is accounted for, not here.
 *
 * ## Costs, in the same shape as the formulation's
 *
 * `unit_cost_amount`, `line_cost_amount` and `cost_currency_code`, major-unit
 * decimals at six places (master plan v2 §4.4), named `*_amount` and never
 * `*_minor`. The unit cost is copied from the packaging item at write time
 * rather than joined at read time — the same decision `recipe_version_lines`
 * makes about ingredients. A sheet costed in March must still say what it said
 * in March after somebody edits the bottle's price in April.
 *
 * ## Isolation: `join-rls-parent`, like outputs and steps
 *
 * No PostgreSQL policy of its own. These rows are reachable only through a
 * version, cascade-delete with it, and sit behind the policy on
 * `recipe_versions` — the same argument the K1.2 RLS migration makes for
 * `recipe_version_outputs` and `recipe_version_steps`. A formulation is the
 * commercially sensitive thing and it has its own policy; the list of boxes it
 * ships in is protected by the version above it, and a fifth policy would be a
 * predicate evaluated on every row of every query to buy no isolation the
 * parent does not already provide.
 *
 * **No unique key on (version, packaging item).** A version that uses the same
 * sticker on the lid and on the sleeve is two lines. Identity is
 * `(recipe_version_id, line_number)`, exactly as it is for formulation lines.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_version_packaging', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->integer('line_number');

            /*
             * `ingredient_id`, because packaging is an ingredient — one filed under
             * `packaging-disposables`. This column named `packaging_items` while the family had a
             * table of its own; the merge back renames it, and a fresh database gets the final
             * name here rather than creating the old one and immediately renaming it.
             *
             * `restrictOnDelete`, matching `ingredient_id` on the formulation lines (appendix D,
             * OD-8): a packaging item a version still references is part of that version's cost
             * record and cannot be deleted out from under it.
             */
            $table->foreignUuid('ingredient_id')->constrained('ingredients')->restrictOnDelete();

            $table->string('basis', 20)
                ->comment('fills_yield | per_container | per_batch — where `quantity` comes from');

            // Not nullable, unlike a formulation line's quantity. A packaging
            // line always has a number: two of the three bases compute one and
            // the third requires it. The nullability on `recipe_version_lines`
            // exists because the sauces source lists ingredients with no
            // amounts, and no equivalent source gap exists here.
            $table->decimal('quantity', 12, 4);
            $table->foreignUuid('unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();

            $table->decimal('unit_cost_amount', 18, 6)->nullable()->comment('major currency units (§4.4), never minor');
            $table->decimal('line_cost_amount', 18, 6)->nullable()->comment('quantity × unit cost, derived, never accepted');
            $table->string('cost_currency_code', 3)->nullable();

            $table->string('comment', 255)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('cost_currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique(['recipe_version_id', 'line_number']);
            $table->index('ingredient_id');
        });

        DB::statement('ALTER TABLE recipe_version_packaging ADD CONSTRAINT recipe_version_packaging_line_number_check CHECK (line_number > 0)');

        // Zero is refused as well as negative. A packaging line that consumes
        // nothing is a line that should not exist, and storing one would put a
        // row on the sheet contributing nothing but a name.
        DB::statement('ALTER TABLE recipe_version_packaging ADD CONSTRAINT recipe_version_packaging_quantity_check CHECK (quantity > 0)');

        DB::statement("ALTER TABLE recipe_version_packaging ADD CONSTRAINT recipe_version_packaging_basis_check CHECK (basis IN ('fills_yield', 'per_container', 'per_batch'))");

        // A monetary value without its currency is not a monetary value
        // (§4.4) — the same constraint `recipe_version_lines` carries.
        DB::statement('ALTER TABLE recipe_version_packaging ADD CONSTRAINT recipe_version_packaging_cost_currency_check CHECK ((unit_cost_amount IS NULL AND line_cost_amount IS NULL) OR cost_currency_code IS NOT NULL)');

        /*
         * Packaging waste is its own coefficient, beside the production one.
         *
         * The source sheet applies two different percentages on one page — one
         * to the raw-material cost per unit, another to the packaging cost per
         * unit — and they are different numbers because they measure different
         * losses. Process loss is sauce left in the pot; packaging loss is
         * mis-fed labels and split film. Reusing `waste_coefficient_percent`
         * for both would make correcting one silently rewrite the other.
         *
         * Defaulted to zero rather than to the sheet's figure: a version whose
         * packaging nobody has thought about should not quietly inflate its
         * cost by a percentage nobody chose. The editor's placeholder is where
         * the conventional figure is suggested.
         */
        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->decimal('packaging_waste_percent', 5, 2)->default(0)
                ->comment('loss on packaging, distinct from waste_coefficient_percent which is process loss');
        });

        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_packaging_waste_check CHECK (packaging_waste_percent >= 0 AND packaging_waste_percent < 100)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE recipe_versions DROP CONSTRAINT IF EXISTS recipe_versions_packaging_waste_check');

        Schema::table('recipe_versions', function (Blueprint $table): void {
            $table->dropColumn('packaging_waste_percent');
        });

        Schema::dropIfExists('recipe_version_packaging');
    }
};
