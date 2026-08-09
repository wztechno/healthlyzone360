<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `measurement_units.base_ratio` (INV1.0): the factor that turns a quantity in
 * this unit into the dimension's canonical base, so that conversion within a
 * dimension is data rather than a table of special cases held in code.
 *
 * The canonical base of each convertible dimension is its SI-ish smallest
 * seeded unit: **mass = gram**, **volume = millilitre**. A conversion is then
 * `quantity × from.base_ratio ÷ to.base_ratio`, done in bcmath by
 * `UnitConversionService`.
 *
 * Only mass and volume convert. `count`, `serving`, `package`, `energy` and
 * `length` all carry `base_ratio` 1 and never cross-convert — not across a
 * dimension and not *within* one either (a bunch is not a can, and kcal↔kJ is
 * a real conversion this system has deliberately not validated, so the service
 * refuses it rather than lie). The factor 1 on those rows is a harmless
 * identity the service never divides by; the refusal lives in the service, and
 * the column stays honest by carrying no fabricated cross-pack ratio.
 *
 * The culinary spoon-and-cup volumes are **approximate** — a cup of flour and a
 * cup of water weigh different amounts, and even by volume the figures are
 * rounded kitchen conventions rather than exact definitions — and so is
 * `gallon`, whose US (3785.411784 ml) and imperial (4546.09 ml) readings differ
 * and whose seeded `unit_system` does not disambiguate. They are seeded with
 * the common culinary values and flagged approximate in the column comment so a
 * later, exact pack-variant conversion can supersede them without anyone having
 * mistaken the estimate for a definition.
 *
 * Backfilled here so the column can be NOT NULL from the moment it exists,
 * exactly as the `dimension` migration does. On a fresh database the table is
 * empty at migrate time (the seeder runs afterwards), so the backfill is a
 * no-op and the seeder writes `base_ratio` directly; on an already-seeded
 * database the map below fills the nineteen rows that exist.
 */
return new class extends Migration
{
    /**
     * The factor to each dimension's canonical base, for every code the
     * foundation seeds. Anything not named is an identity-1 unit.
     *
     * @var array<string, string>
     */
    private const array BASE_RATIOS = [
        // mass, base = gram
        'kg' => '1000',
        'g' => '1',
        'mg' => '0.001',

        // volume, base = millilitre
        'l' => '1000',
        'ml' => '1',

        // volume — APPROXIMATE culinary measures
        'tsp' => '5',
        'tbsp' => '15',
        'cup' => '240',
        'gallon' => '3785.411784',
    ];

    private const string COMMENT = 'Factor to the dimension canonical base (mass=gram, volume=millilitre). 1 for count/serving/package/energy/length, which never cross-convert. tsp/tbsp/cup and gallon are APPROXIMATE culinary volumes.';

    public function up(): void
    {
        Schema::table('measurement_units', function (Blueprint $table): void {
            $table->decimal('base_ratio', 20, 9)
                ->nullable()
                ->after('dimension')
                ->comment(self::COMMENT);
        });

        foreach (self::BASE_RATIOS as $code => $ratio) {
            DB::table('measurement_units')->where('code', $code)->update(['base_ratio' => $ratio]);
        }

        // Every remaining unit — count, serving, package, energy, length — is
        // its own base: a factor of 1 the service will never divide across
        // dimensions.
        DB::table('measurement_units')->whereNull('base_ratio')->update(['base_ratio' => '1']);

        Schema::table('measurement_units', function (Blueprint $table): void {
            $table->decimal('base_ratio', 20, 9)->nullable(false)->change();
        });

        DB::statement('ALTER TABLE measurement_units ADD CONSTRAINT measurement_units_base_ratio_check CHECK (base_ratio > 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE measurement_units DROP CONSTRAINT measurement_units_base_ratio_check');

        Schema::table('measurement_units', function (Blueprint $table): void {
            $table->dropColumn('base_ratio');
        });
    }
};
