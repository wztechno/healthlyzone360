<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * How long a subscription runs for: five days, twenty, forty, sixty — or not
 * at all, because the customer is buying it once.
 *
 * **`duration_kind` replaces the zero-day sentinel** (master plan §4.3, adopted
 * from the reviewer's point 3). The legacy design encoded "a one-off order, not
 * a subscription" as a duration of `0` days, which is the kind of magic value
 * that reads as data: every consumer has to know the convention, one that does
 * not divides a price by zero, and a report that sums durations quietly counts
 * the one-offs as free. So the *kind* is the column that carries the meaning
 * and `duration_days` carries the number, nullable because a one-off has no
 * number to carry.
 *
 * The CHECK is written as the full disjunction —
 * `(one_off AND days IS NULL) OR (fixed_days AND days > 0)` — so it refuses
 * **both** halves of the mistake at once: a one-off that carries a length, and
 * a fixed run that does not. Enforced by PostgreSQL rather than by a service,
 * because the sentinel is exactly the sort of thing an importer or a backfill
 * would reintroduce, and the whole value of removing it is that it cannot come
 * back. The request layer refuses the same two shapes with a sentence a human
 * can act on; the constraint is what makes the refusal true of every writer.
 *
 * 5, 20, 40 and 60 days all remain ordinary `fixed_days` rows — the model was
 * changed to lose the sentinel, not the lengths.
 *
 * `restrictOnDelete` from `plan_variant_durations`: a duration a plan is sold
 * in cannot be removed, only deactivated.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope in K1.6**.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_durations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 40);
            $table->string('duration_kind', 20)->comment('one_off | fixed_days — replaces the zero-day sentinel (§4.3)');
            $table->integer('duration_days')->nullable()->comment('NULL for a one-off; > 0 for a fixed run');
            $table->string('name_en');
            $table->string('name_ar');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'is_active']);
        });

        DB::statement("ALTER TABLE plan_durations ADD CONSTRAINT plan_durations_duration_kind_check CHECK (duration_kind IN ('one_off', 'fixed_days'))");
        // `IS NOT NULL` is spelled out rather than left to `> 0`, and it is
        // load-bearing: `NULL > 0` evaluates to NULL, a CHECK passes on
        // anything that is not FALSE, and without it a `fixed_days` row with no
        // length would slip straight through the constraint that exists to stop
        // exactly that.
        DB::statement("ALTER TABLE plan_durations ADD CONSTRAINT plan_durations_duration_days_check CHECK ((duration_kind = 'one_off' AND duration_days IS NULL) OR (duration_kind = 'fixed_days' AND duration_days IS NOT NULL AND duration_days > 0))");
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_durations');
    }
};
