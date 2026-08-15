<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `stock_levels.organisation_id` (INV1.0 integrity fix): the table had **no
 * organisation scope at all**. `StockLevel` alone among the inventory models
 * carried neither the `organisation_id` column nor `BelongsToOrganisation`, so a
 * query that forgot to constrain by branch could read one kitchen's quantities
 * from inside another. The branch already implies the organisation; this makes
 * that implication a column the application scope and any future policy can
 * stand on.
 *
 * Backfilled from each level's branch, then made NOT NULL — every level has a
 * branch, so every level has an organisation. On a fresh database the table is
 * empty and the NOT NULL lands on nothing. The foreign key cascades on delete,
 * matching `stock_items` and `stock_movements`: an organisation removed takes
 * its stock with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_levels', function (Blueprint $table): void {
            $table->uuid('organisation_id')->nullable()->after('id');
        });

        DB::statement(
            'UPDATE stock_levels sl SET organisation_id = ob.organisation_id
             FROM organisation_branches ob WHERE ob.id = sl.branch_id'
        );

        Schema::table('stock_levels', function (Blueprint $table): void {
            $table->uuid('organisation_id')->nullable(false)->change();
        });

        Schema::table('stock_levels', function (Blueprint $table): void {
            $table->foreign('organisation_id')->references('id')->on('organisations')->cascadeOnDelete();
            $table->index('organisation_id');
        });
    }

    public function down(): void
    {
        Schema::table('stock_levels', function (Blueprint $table): void {
            $table->dropForeign(['organisation_id']);
            $table->dropIndex(['organisation_id']);
            $table->dropColumn('organisation_id');
        });
    }
};
