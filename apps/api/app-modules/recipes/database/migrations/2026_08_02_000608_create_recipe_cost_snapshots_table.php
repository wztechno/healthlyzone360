<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What one version of a recipe cost, at one moment, on one basis.
 *
 * **Append-only** (§4.12 `append-only-ledger`). A snapshot is an answer to
 * "what did we believe this cost on the day we published it", and an answer
 * that can be edited afterwards answers nothing. The model declares
 * `UPDATED_AT = null`, and the paired row-level-security migration removes
 * `UPDATE` and `DELETE` from the runtime roles entirely — the same treatment
 * `audit_logs` gets, for the same reason. Superseding a snapshot means writing
 * a newer one.
 *
 * **Two bases, and the distinction is the point.**
 *
 * - `recalculated` — arithmetic this system performed over the version's
 *   lines. Reproducible: the same lines and the same yield produce the same
 *   numbers.
 * - `as_recorded` — the numbers a source technical sheet stated, stored
 *   verbatim, *including its errors*. The 29 Healthy360 sheets do their own
 *   arithmetic and several of them do it wrong (appendix D, data-quality
 *   ledger); silently correcting a sheet would destroy the evidence that it
 *   needs correcting, and silently trusting it would put a wrong number
 *   behind a right-looking label. Storing both and labelling which is which is
 *   the only honest option. `as_recorded` rows are written by the K1.8
 *   importer; the API never offers that basis.
 *
 * **`source_label` and `basis_mismatch` exist because the sheet labels lie.**
 * Appendix D findings #1 and #2: at least five sheets label a figure "cost per
 * kg" while the yield beside it is a piece count, or vice versa. The rule this
 * schema encodes is therefore: *the basis is derived from the version's yield
 * fields, never from the label*. `source_label` keeps the sheet's own wording
 * verbatim so a human can see what was claimed, and `basis_mismatch` is raised
 * when the claim and the yield cannot both be true. Neither column is ever
 * consulted to decide what a number means.
 *
 * **Costs are major-unit decimals** (master plan v2 §4.4): `3.900000` is three
 * dollars ninety, which is why every monetary column here is named `*_amount`
 * and carries `currency_code` beside it. Prices — a different concept, on a
 * different table, in a later slice — stay `amount_minor` integers, and
 * nothing sums one into the other.
 *
 * `waste_coefficient_percent` is copied from the version at calculation time
 * rather than joined at read time: the source sheets apply a flat +3 % and a
 * kitchen that later revises that allowance must not retroactively rewrite
 * what an old snapshot said.
 *
 * Isolation strategy: `org-rls` **and** `append-only-ledger` — a policy on
 * `organisation_id` confines reads and inserts to one kitchen, and the revoked
 * grants make the rows immutable to the application role. Costs are the second
 * most sensitive thing in this schema after the formulation itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_cost_snapshots', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('recipe_version_id')->constrained('recipe_versions')->cascadeOnDelete();

            // Denormalised from the parent so the row-level-security policy is
            // a column comparison rather than a join evaluated per row.
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();

            $table->string('currency_code', 3);
            $table->string('basis', 20)->comment('as_recorded | recalculated');

            $table->decimal('total_input_cost_amount', 18, 6);

            // Nullable because they are only computable when the version says
            // what it yields. A recipe whose yield nobody has measured has a
            // total and nothing else, and inventing a denominator to fill the
            // column would be the fabrication this programme exists to avoid.
            $table->decimal('cost_per_yield_unit_amount', 18, 6)->nullable();
            $table->foreignUuid('yield_unit_id')->nullable()->constrained('measurement_units')->restrictOnDelete();
            $table->decimal('cost_per_piece_amount', 18, 6)->nullable();

            $table->decimal('waste_coefficient_percent', 5, 2);
            $table->decimal('cost_per_yield_unit_with_waste_amount', 18, 6)->nullable();
            $table->decimal('cost_per_piece_with_waste_amount', 18, 6)->nullable();

            $table->string('source_label', 60)->nullable()->comment('the source sheet wording, verbatim; never consulted to decide what a number means');
            $table->boolean('basis_mismatch')->default(false);

            $table->timestamp('calculated_at');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();

            // No updated_at: the model declares UPDATED_AT = null and the
            // runtime roles lose UPDATE entirely in the paired migration.
            $table->timestamp('created_at')->nullable();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            // The read this table exists for: "the latest snapshot of this
            // version", per basis.
            $table->index(['recipe_version_id', 'calculated_at']);
        });

        DB::statement("ALTER TABLE recipe_cost_snapshots ADD CONSTRAINT recipe_cost_snapshots_basis_check CHECK (basis IN ('as_recorded', 'recalculated'))");
        DB::statement('ALTER TABLE recipe_cost_snapshots ADD CONSTRAINT recipe_cost_snapshots_total_input_cost_check CHECK (total_input_cost_amount >= 0)');
        DB::statement('ALTER TABLE recipe_cost_snapshots ADD CONSTRAINT recipe_cost_snapshots_waste_coefficient_check CHECK (waste_coefficient_percent >= 0)');

        // A per-unit cost without the unit it is per is not a cost, it is a
        // number. The unit travels with the figure or the figure does not
        // exist.
        DB::statement('ALTER TABLE recipe_cost_snapshots ADD CONSTRAINT recipe_cost_snapshots_yield_unit_check CHECK (cost_per_yield_unit_amount IS NULL OR yield_unit_id IS NOT NULL)');

        // A with-waste figure is a derivation of its base figure; one cannot
        // exist without the other.
        DB::statement('ALTER TABLE recipe_cost_snapshots ADD CONSTRAINT recipe_cost_snapshots_yield_waste_check CHECK (cost_per_yield_unit_with_waste_amount IS NULL OR cost_per_yield_unit_amount IS NOT NULL)');
        DB::statement('ALTER TABLE recipe_cost_snapshots ADD CONSTRAINT recipe_cost_snapshots_piece_waste_check CHECK (cost_per_piece_with_waste_amount IS NULL OR cost_per_piece_amount IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_cost_snapshots');
    }
};
