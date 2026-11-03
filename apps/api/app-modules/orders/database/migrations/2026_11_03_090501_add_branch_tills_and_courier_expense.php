<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One till per branch, and a courier's fee on a prepaid run as a kitchen expense.
 *
 * **Tills.** A hand-in and a close each belong to one branch. A hand-in's branch is
 * the branch of the orders it covers, which `TillBranches` resolves. Rows from
 * before this keep a null branch and read as the kitchen's first branch, so
 * nothing is rewritten. The close's uniqueness moves from the kitchen to the
 * branch: two branches open their first shift at the same local midnight. Nulls
 * are not distinct, so the rows from before keep their old guarantee.
 *
 * **Expense.** A courier run on an order that owed nothing at the door brought no
 * cash, so its fee cannot come off a hand-in. It is recorded on the batch as
 * `expense_minor`, outside the hand-in's arithmetic, and the existing CHECK on
 * `short_minor` is unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_settlements', function (Blueprint $table): void {
            $table->bigInteger('expense_minor')->default(0)->comment('couriers\' fees on prepaid runs, paid by the kitchen; never netted from the hand-in');
            $table->foreignUuid('branch_id')->nullable()->comment('the till the hand-in went into; null before tills were per branch')->constrained('organisation_branches')->nullOnDelete();
        });

        DB::statement('ALTER TABLE cash_settlements ADD CONSTRAINT cash_settlements_expense_check CHECK (expense_minor >= 0)');

        Schema::table('daily_closes', function (Blueprint $table): void {
            $table->foreignUuid('branch_id')->nullable()->comment('the till counted; null before tills were per branch')->constrained('organisation_branches')->nullOnDelete();
            $table->dropUnique(['organisation_id', 'currency_code', 'opened_at']);
        });

        DB::statement('ALTER TABLE daily_closes ADD CONSTRAINT daily_closes_branch_shift_unique UNIQUE NULLS NOT DISTINCT (organisation_id, branch_id, currency_code, opened_at)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE daily_closes DROP CONSTRAINT daily_closes_branch_shift_unique');

        Schema::table('daily_closes', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('branch_id');
            $table->unique(['organisation_id', 'currency_code', 'opened_at']);
        });

        Schema::table('cash_settlements', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('branch_id');
            $table->dropColumn('expense_minor');
        });
    }
};
