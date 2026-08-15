<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `measurement_units.dimension` (master plan v2 §4.5): automatic conversion is
 * only ever legitimate *within* a dimension, so the dimension has to be data
 * rather than a convention held in someone's head.
 *
 * The master plan names five dimensions (mass, volume, count, serving,
 * package). The fourteen units the foundation already seeds need two more to
 * be described honestly: `kcal`/`kJ` are energy, and `cm`/`m` are length —
 * neither is a mass, a volume, a count, a serving or a package. Forcing them
 * into one of the five would make the "convert only within a dimension" rule
 * silently wrong, so the CHECK carries seven values. Conversions across any
 * two of them remain forbidden; the widening does not weaken the rule, it
 * stops the rule from lying.
 *
 * `unit_system` gains `packaging` for the retail/wholesale pack units
 * (bunch, can, bag, bottle) that are neither metric, imperial nor clinical.
 */
return new class extends Migration
{
    /**
     * The dimension of every unit code the foundation seeds, plus the pack
     * units this migration's seeder companion introduces. Backfilled here so
     * the column can be NOT NULL from the moment it exists.
     *
     * @var array<string, string>
     */
    private const array DIMENSIONS = [
        'g' => 'mass',
        'mg' => 'mass',
        'kg' => 'mass',
        'ml' => 'volume',
        'l' => 'volume',
        'cm' => 'length',
        'm' => 'length',
        'kcal' => 'energy',
        'kJ' => 'energy',
        'piece' => 'count',
        'serving' => 'serving',
        'tsp' => 'volume',
        'tbsp' => 'volume',
        'cup' => 'volume',
    ];

    public function up(): void
    {
        Schema::table('measurement_units', function (Blueprint $table): void {
            $table->string('dimension', 20)
                ->nullable()
                ->after('code')
                ->comment('mass | volume | count | serving | package | energy | length');
        });

        foreach (self::DIMENSIONS as $code => $dimension) {
            DB::table('measurement_units')->where('code', $code)->update(['dimension' => $dimension]);
        }

        // Anything the foundation did not seed (none today) is a count until a
        // human says otherwise: the safest default is the one that cannot be
        // silently converted into a mass or a volume.
        DB::table('measurement_units')->whereNull('dimension')->update(['dimension' => 'count']);

        Schema::table('measurement_units', function (Blueprint $table): void {
            $table->string('dimension', 20)->nullable(false)->change();
        });

        DB::statement("ALTER TABLE measurement_units ADD CONSTRAINT measurement_units_dimension_check CHECK (dimension IN ('mass', 'volume', 'count', 'serving', 'package', 'energy', 'length'))");

        DB::statement('ALTER TABLE measurement_units DROP CONSTRAINT measurement_units_unit_system_check');
        DB::statement("ALTER TABLE measurement_units ADD CONSTRAINT measurement_units_unit_system_check CHECK (unit_system IN ('metric', 'imperial', 'clinical', 'packaging'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE measurement_units DROP CONSTRAINT measurement_units_dimension_check');

        Schema::table('measurement_units', function (Blueprint $table): void {
            $table->dropColumn('dimension');
        });

        // The pack units seeded alongside this migration would violate the
        // narrower constraint, so they go before it is restored.
        DB::table('measurement_units')->where('unit_system', 'packaging')->delete();

        DB::statement('ALTER TABLE measurement_units DROP CONSTRAINT measurement_units_unit_system_check');
        DB::statement("ALTER TABLE measurement_units ADD CONSTRAINT measurement_units_unit_system_check CHECK (unit_system IN ('metric', 'imperial', 'clinical'))");
    }
};
