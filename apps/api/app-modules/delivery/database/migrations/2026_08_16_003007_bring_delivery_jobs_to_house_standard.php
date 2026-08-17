<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The table that had no producer gets one, and the three things it was missing
 * because of that.
 *
 * ## What a delivery job is
 *
 * One journey: this kitchen's food, this order, one driver, one door. It is
 * deliberately *not* a copy of the order — the address, the window and the
 * customer's number all live on `orders` and are read through the join — and it
 * is deliberately not a status column on `orders` either. An order is a
 * commercial fact that is placed, confirmed, fulfilled or cancelled; a run is an
 * operational one that is assigned, collected, driven and either delivered or
 * failed, and the two lifecycles move on different days for different reasons.
 * Folding them together would mean a kitchen could not say "we cooked it and the
 * driver could not find the building", which is a Tuesday.
 *
 * ## Why `unique(order_id)`, and why it is now load-bearing rather than tidy
 *
 * One order is one journey. The constraint has been on the table since
 * `2026_08_04_002501_create_delivery_jobs_table` and until now it constrained
 * nothing that existed: **nothing in the platform created a delivery job**. F1
 * built the table, the dispatch board and the driver's run sheet, and left the
 * producer for later; the rows were written by fixtures and by hand.
 *
 * C3 is the later. `OrderLifecycle::confirm()` now projects a job for every
 * delivery order through `DeliveryJobProjection`, and it does so **inside the
 * confirm transaction**, which can re-run — a lost-update retry against
 * `If-Match` is an ordinary event and the closure runs again when it does. The
 * projector therefore does not read-then-write; it inserts and treats SQLSTATE
 * 23505 as "somebody already did this", which makes this unique index the whole
 * of the idempotency guarantee rather than a second opinion about it. Two jobs
 * for one order is two drivers at one door.
 *
 * ## `lock_version` arrives because a second writer arrived
 *
 * `POST /delivery/jobs/{job}/assign` is the first endpoint that *changes* a job.
 * Everything before it either created one (nothing did) or was the driver
 * stamping their own row delivered, which no second person is racing.
 * Assignment is different: a dispatch board is a shared screen showing the same
 * unassigned run to two dispatchers, and both of them can see a free driver.
 * Without a validator the second write silently wins, one driver is told about a
 * job that is no longer theirs, and the row remembers only the later of the two
 * decisions. With it, the second dispatcher is told the job moved and re-reads —
 * the platform's standard answer, and the reason `precondition` middleware
 * exists at all (master plan v2 §4.13).
 *
 * `integer NOT NULL DEFAULT 0` matches every other lock-versioned table here, and
 * the default is also the backfill: the rows that exist are at version zero, which
 * is what a client that has never read one would assume anyway.
 *
 * ## What was checked against the house standard and deliberately *not* added
 *
 * **`updated_at` is not a gap.** The create migration already calls
 * `timestamps()`, so both columns are there; the assignment write stamps
 * `updated_at` through Eloquent like every other write on the platform.
 *
 * **`created_by` is not added.** On the tables that carry it, it names the
 * person who decided a row should exist. Nobody decides a delivery job exists —
 * it is projected from a confirm, sometimes by a background generation run — so
 * the column would be null on every row that matters and would invite a reader
 * to believe otherwise. Who assigned the driver is the interesting authorship
 * question here, and it is answered by the `delivery.job_assigned` audit event,
 * which carries the actor and the moment without pretending a job has an author.
 *
 * ## The two indexes, and the one that was rejected
 *
 * Both reads on this table become real in this commit for the same reason the
 * unique index does — the table goes from "written by fixtures" to "one row per
 * confirmed delivery order" — so the predicates they were written with are now
 * predicates against a growing table. PostgreSQL indexes no foreign key
 * automatically, so `organisation_id`, `branch_id` and `driver_user_id` carried
 * none.
 *
 *  * `(organisation_id, created_at)` — `DeliveryJobIndexController`, the
 *    dispatch board: the organisation scope's equality, then `ORDER BY
 *    created_at DESC LIMIT 50`. Without it the fifty newest rows cost a sort of
 *    every job the kitchen has ever run, and that set only ever grows because
 *    the board deliberately shows delivered and cancelled runs too.
 *  * `(organisation_id, driver_user_id)` — `DriverJobIndexController`, the
 *    driver's own run sheet, and the query this commit's assignment endpoint
 *    exists to populate. Before assignment there was nothing to write
 *    `driver_user_id` at all, so this lookup has never had rows to find; from
 *    here it is what every driver's app calls on a poll.
 *
 * **`(organisation_id, status)` was considered and left out.** Nothing filters
 * on status alone. The board reads every state on purpose, and the run sheet's
 * `status NOT IN ('delivered', 'cancelled')` is an anti-predicate applied to one
 * driver's handful of rows — already narrowed by the index above — where a scan
 * is cheaper than a second index to maintain on every assignment and every
 * delivery stamp. An index for a query nobody writes is a write cost with no
 * reader, and the honest moment to add it is when a dispatch board grows a
 * status filter.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->integer('lock_version')
                ->default(0)
                ->comment('optimistic-concurrency validator; two dispatchers looking at the same unassigned run would otherwise both assign it and the row would remember only the later decision');

            $table->index(['organisation_id', 'created_at']);
            $table->index(['organisation_id', 'driver_user_id']);
        });
    }

    public function down(): void
    {
        Schema::table('delivery_jobs', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'driver_user_id']);
            $table->dropIndex(['organisation_id', 'created_at']);
            $table->dropColumn('lock_version');
        });
    }
};
