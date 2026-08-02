<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * When a branch is open, and how late an order for that day may still be
 * placed — the branch operating data the v1 table catalogue missed (master
 * plan v2, reviewer point 19).
 *
 * It missed it because the draft wire contract already carried opening hours
 * and a cut-off while the Kitchens module stayed `planned`, which is exactly
 * the shape of gap the review was looking for: a public surface with no schema
 * under it. This table is the schema.
 *
 * **One row per weekday, seven per branch, and a closed day is a row.** The
 * alternative — no row means closed — cannot tell "we are shut on Sunday"
 * apart from "nobody has filled in Sunday", and those have to be different if
 * a checkout is ever going to say why it refused a delivery date. So a closed
 * day is a row with `opens_at` and `closes_at` both NULL, and its absence
 * means the week is unconfigured.
 *
 * The CHECKs encode that exactly:
 *
 * - `(opens_at IS NULL) = (closes_at IS NULL)` — a day is open with both times
 *   or closed with neither. Half a day is not a state anybody can act on;
 * - `closes_at > opens_at` when both are present. **No overnight service**,
 *   the same limitation `delivery_windows` takes and for the same reason: a
 *   day-rollover rule that order capture has not agreed to is a rule nobody
 *   has tested;
 * - `order_cut_off_at IS NULL OR opens_at IS NOT NULL` — a cut-off on a closed
 *   day is meaningless, and a system that stored it would eventually read it.
 *
 * The cut-off is deliberately **not** required on an open day. A kitchen that
 * takes orders until the van leaves has no cut-off, and NULL says that
 * honestly. Nor is it constrained to fall inside the opening hours: "order by
 * 22:00 the night before for tomorrow morning" is a real rule, and a
 * constraint tying the cut-off to the same day's window would forbid it.
 * Which day a cut-off governs is C1's question, not this table's; what this
 * table records is the time.
 *
 * `weekday` is ISO-8601 — 1 = Monday … 7 = Sunday — matching
 * `delivery_windows.weekdays` and PHP's `CarbonImmutable::dayOfWeekIso`, so
 * nothing in this programme has to convert between two weekday conventions.
 *
 * Times are `time`, read in the branch's own timezone
 * (`organisation_branches.timezone`) — a clock face, not an instant.
 *
 * No `lock_version`: the week is replaced as a whole in one transaction, so
 * there is no half-week for a validator to protect. The unit of change is the
 * seven rows together.
 *
 * Isolation strategy: `join-rls-parent` — reached only through a branch,
 * cascade-deleted with it, carrying `organisation_id` so a policy could be
 * evaluated directly. `organisation_branches` already carries a PostgreSQL
 * policy; opening hours are a customer-facing fact about a place and do not
 * need one of their own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_opening_hours', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('organisation_branches')->cascadeOnDelete();
            $table->smallInteger('weekday')->comment('ISO-8601: 1 = Monday … 7 = Sunday');
            $table->time('opens_at')->nullable();
            $table->time('closes_at')->nullable();
            $table->time('order_cut_off_at')->nullable()->comment('last moment an order for this day is accepted; NULL = until the van leaves');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['branch_id', 'weekday']);
            $table->index(['organisation_id', 'branch_id']);
        });

        DB::statement('ALTER TABLE branch_opening_hours ADD CONSTRAINT branch_opening_hours_weekday_check CHECK (weekday BETWEEN 1 AND 7)');

        // A day is open with both times or closed with neither.
        DB::statement('ALTER TABLE branch_opening_hours ADD CONSTRAINT branch_opening_hours_pair_check CHECK ((opens_at IS NULL) = (closes_at IS NULL))');

        // No overnight service in K1.7.
        DB::statement('ALTER TABLE branch_opening_hours ADD CONSTRAINT branch_opening_hours_time_order_check CHECK (opens_at IS NULL OR closes_at > opens_at)');

        // A cut-off on a closed day is a time nobody can act on.
        DB::statement('ALTER TABLE branch_opening_hours ADD CONSTRAINT branch_opening_hours_cut_off_check CHECK (order_cut_off_at IS NULL OR opens_at IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_opening_hours');
    }
};
