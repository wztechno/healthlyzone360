<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `production_tasks` gets the organisation column every tenant-owned table has
 * (PROD1).
 *
 * The table has no reader and no writer in any shipped surface — there is no task
 * UI and PROD1 does not add one — and that is precisely why this is worth doing
 * now rather than later. A tenant-owned table with no tenancy column is a latent
 * leak: the first query anybody writes against it will be scoped by whatever they
 * remember, and a model with no `BelongsToOrganisation` fails **open** rather than
 * closed. Adding the column before the first reader exists means the first reader
 * inherits the global scope instead of having to be reviewed for it.
 *
 * Nullable, backfilled from the parent order, then made NOT NULL — the house
 * three-step, run even though the table is certainly empty, because "certainly
 * empty" is an assumption about every environment rather than a fact about any.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('production_tasks', function (Blueprint $table): void {
            $table->uuid('organisation_id')->nullable()->after('id');
        });

        DB::statement('UPDATE production_tasks SET organisation_id = (SELECT o.organisation_id FROM production_orders o WHERE o.id = production_tasks.production_order_id) WHERE organisation_id IS NULL');

        // A task whose order has gone is unreachable and uncountable; there is no
        // honest organisation to give it, so it goes rather than being invented.
        DB::statement('DELETE FROM production_tasks WHERE organisation_id IS NULL');

        Schema::table('production_tasks', function (Blueprint $table): void {
            $table->uuid('organisation_id')->nullable(false)->change();
            $table->foreign('organisation_id')->references('id')->on('organisations')->cascadeOnDelete();
            $table->index(['organisation_id', 'production_order_id']);
        });
    }

    public function down(): void
    {
        Schema::table('production_tasks', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'production_order_id']);
            $table->dropConstrainedForeignId('organisation_id');
        });
    }
};
