<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One cell of a plan's availability matrix: this meal combination, at this
 * service tier, in this energy band.
 *
 * **Variant existence encodes the availability matrix** (appendix D). There is
 * no `is_available` flag and no row-per-combination grid with holes in it: a
 * cell a kitchen sells is a `catalogue_item_variants` row of type
 * `plan_configuration` with a profile here, and a cell it does not sell is the
 * absence of one. That is what makes the matrix and the pricing path the same
 * object — a plan configuration is priced exactly the way a pack is, through
 * `price_list_items.catalogue_item_variant_id`, and a "matrix" modelled beside
 * the variants would need a second pricing path to be worth anything.
 *
 * **The variant identifier is the primary key**, as on pack variants: a cell
 * *is* the variant seen from the commercial side. `catalogue_item_id` is
 * denormalised beside it so the uniqueness below can be stated at all — a
 * unique index cannot reach through a join.
 *
 * **`UNIQUE (catalogue_item_id, meal_combination_option_id, service_tier,
 * energy_band_id) NULLS NOT DISTINCT`** — a matrix cell exists once. The
 * `NULLS NOT DISTINCT` is the load-bearing half rather than a nicety: a kitchen
 * that does not band by energy has every cell carrying a NULL band, and under
 * PostgreSQL's default NULL semantics "lunch and dinner, premium, no band"
 * could be created any number of times, which is precisely the duplicate the
 * constraint exists to refuse. The same argument `price_list_items` makes about
 * its own partial index.
 *
 * The uniqueness is deliberately **not** restricted to active variants. An
 * archived cell keeps its coordinates because a price row still points at it,
 * so re-selling that cell means reviving that variant (submit it under its own
 * code) rather than opening a second one at the same address. A submission that
 * tries the second is refused with the occupying code named.
 *
 * `meal_combination_option_id` and `energy_band_id` are `restrictOnDelete`: a
 * vocabulary row a plan is sold on cannot be deleted, only deactivated. The
 * band is **nullable** — a kitchen that does not portion by calories has plans
 * with no band, which is a different fact from a band nobody has filled in.
 *
 * `meals_per_day` and `snacks_per_day` are stored on the cell rather than read
 * from the combination, because a premium tier legitimately adds a snack to the
 * same combination. The combination says which sittings; the cell says what
 * this configuration actually delivers.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_variant_profiles', function (Blueprint $table): void {
            $table->foreignUuid('catalogue_item_variant_id')->primary()->constrained('catalogue_item_variants')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('catalogue_item_id')
                ->comment('denormalised from the variant so the matrix-cell uniqueness can be stated at all')
                ->constrained('catalogue_items')
                ->cascadeOnDelete();
            $table->foreignUuid('meal_combination_option_id')->constrained('meal_combination_options')->restrictOnDelete();
            $table->foreignUuid('energy_band_id')->nullable()->constrained('energy_bands')->restrictOnDelete();
            $table->string('service_tier', 20)->default('standard')->comment('standard | premium');
            $table->boolean('includes_snacks')->default(false);
            $table->integer('meals_per_day');
            $table->integer('snacks_per_day')->default(0);
            $table->timestamps();
        });

        DB::statement("ALTER TABLE plan_variant_profiles ADD CONSTRAINT plan_variant_profiles_service_tier_check CHECK (service_tier IN ('standard', 'premium'))");
        DB::statement('ALTER TABLE plan_variant_profiles ADD CONSTRAINT plan_variant_profiles_meals_per_day_check CHECK (meals_per_day > 0)');
        DB::statement('ALTER TABLE plan_variant_profiles ADD CONSTRAINT plan_variant_profiles_snacks_per_day_check CHECK (snacks_per_day >= 0)');

        // A matrix cell exists once. NULLS NOT DISTINCT because a kitchen that
        // does not band by energy carries a NULL in every row of the key.
        DB::statement('CREATE UNIQUE INDEX plan_variant_profiles_one_row_per_cell ON plan_variant_profiles (catalogue_item_id, meal_combination_option_id, service_tier, energy_band_id) NULLS NOT DISTINCT');
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_variant_profiles');
    }
};
