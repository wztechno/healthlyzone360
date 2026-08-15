<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `organisations` learns *when*, *why* and *by whom* it was suspended (PA1).
 *
 * **The status CHECK is deliberately untouched.** `suspended` has been a legal
 * value since B1 wrote the constraint and survived B2 widening it with
 * `closed`, so PA1 owes no widening migration — the value the platform console
 * writes is already admissible. What was missing is everything around it.
 *
 * A bare `status = 'suspended'` answers "may this tenant trade?" and nothing
 * else. The console has to answer three more questions on the screen where an
 * operator decides whether to reactivate: how long has this been true, what
 * did we say at the time, and who said it. The audit log holds all three, but
 * a suspension banner that has to page a log to render its own subtitle is a
 * banner that will eventually render without one.
 *
 * `suspension_reason` is operator-facing prose, not a vocabulary. A reason
 * code would need a list, the list would need governance, and the honest
 * content here — "unpaid since June, escalated twice, contact unreachable" —
 * does not survive being turned into an enum.
 *
 * All three are cleared on reactivation rather than kept as history. The
 * history of suspensions belongs to `audit_logs`, which is append-only and
 * already records every one; keeping a stale reason on a trading organisation
 * would give the console two sources for one fact and let them disagree.
 *
 * The CHECK says a reason cannot exist without a moment — a row claiming why
 * without when is a row nothing can render.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organisations', function (Blueprint $table): void {
            $table->timestamp('suspended_at')->nullable()->after('status');
            $table->string('suspension_reason', 500)->nullable()->after('suspended_at');
            $table->foreignUuid('suspended_by')->nullable()->after('suspension_reason')->constrained('users')->nullOnDelete();
        });

        DB::statement('ALTER TABLE organisations ADD CONSTRAINT organisations_suspension_reason_check CHECK (suspension_reason IS NULL OR suspended_at IS NOT NULL)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE organisations DROP CONSTRAINT organisations_suspension_reason_check');

        Schema::table('organisations', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('suspended_by');
            $table->dropColumn(['suspended_at', 'suspension_reason']);
        });
    }
};
