<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The two logs the owner chose: fridge and freezer temperatures twice a day, and a
 * batch's cooking core temperature. Cooling and delivery logs were not chosen.
 *
 * Readings are written once. There is no update path and `(unit, day, slot)` is
 * unique, so the log an inspector reads is the log that was kept, stamped by the
 * server with who and when. `out_of_range` is stored rather than derived: changing
 * a fridge's limits next month must not rewrite last month's record.
 *
 * Isolation strategy: `org-rls` on all three, as `order_refunds`.
 */
return new class extends Migration
{
    private const array TABLES = ['temperature_units', 'temperature_readings', 'cooking_temperatures'];

    /**
     * The schema owner is absent on purpose: it bypasses RLS by ownership.
     *
     * @var list<string>
     */
    private const array RUNTIME_ROLES = ['healthy360_app', 'healthy360_test'];

    private const string ORGANISATION_MATCH = "organisation_id::text = current_setting('app.organisation_id', true)";

    public function up(): void
    {
        Schema::create('temperature_units', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('kind', 16)->comment('fridge | freezer');
            $table->decimal('min_c', 5, 1);
            $table->decimal('max_c', 5, 1);
            $table->boolean('active')->default(true);
            $table->timestamps();
            $table->index(['branch_id', 'active']);
        });

        Schema::create('temperature_readings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('temperature_unit_id')->constrained('temperature_units')->restrictOnDelete();
            $table->date('reading_date')->comment('the branch\'s day, set by the server');
            $table->string('slot', 2)->comment('am | pm');
            $table->decimal('celsius', 5, 1);
            $table->boolean('out_of_range');
            $table->string('note', 200)->nullable();
            $table->foreignUuid('recorded_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['temperature_unit_id', 'reading_date', 'slot']);
            $table->index(['organisation_id', 'reading_date']);
        });

        Schema::create('cooking_temperatures', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('production_order_id')->constrained('production_orders')->restrictOnDelete();
            $table->decimal('celsius', 5, 1);
            $table->string('note', 200)->nullable();
            $table->foreignUuid('recorded_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->index(['organisation_id', 'created_at']);
            $table->index('production_order_id');
        });

        DB::statement("ALTER TABLE temperature_units ADD CONSTRAINT temperature_units_kind_check CHECK (kind IN ('fridge', 'freezer'))");
        DB::statement('ALTER TABLE temperature_units ADD CONSTRAINT temperature_units_range_check CHECK (min_c < max_c)');
        DB::statement("ALTER TABLE temperature_readings ADD CONSTRAINT temperature_readings_slot_check CHECK (slot IN ('am', 'pm'))");

        $roles = $this->roles();

        foreach (self::TABLES as $table) {
            DB::statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");

            if ($roles !== null) {
                DB::statement(
                    "CREATE POLICY rls_organisation_scope ON {$table} FOR ALL TO {$roles}
                     USING (".self::ORGANISATION_MATCH.')
                     WITH CHECK ('.self::ORGANISATION_MATCH.')'
                );
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('cooking_temperatures');
        Schema::dropIfExists('temperature_readings');
        Schema::dropIfExists('temperature_units');
    }

    /**
     * The runtime roles that actually exist, as a quoted grantee list.
     */
    private function roles(): ?string
    {
        /** @var list<string> $existing */
        $existing = DB::connection()
            ->table('pg_roles')
            ->whereIn('rolname', self::RUNTIME_ROLES)
            ->orderBy('rolname')
            ->pluck('rolname')
            ->all();

        if ($existing === []) {
            return null;
        }

        return implode(', ', array_map(static fn (string $role): string => '"'.$role.'"', $existing));
    }
};
