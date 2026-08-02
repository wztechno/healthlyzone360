<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A corporate relationship ending — **shell only** (master plan v2 Phase B2).
 *
 * The table, its states and its model exist in B1; no service does. That is a
 * deliberate half-build rather than an oversight, and the reason is the one
 * the reviewer's point 13 makes about closure blockers: an offboarding flow
 * written before orders, invoices and settlement exist would ship a
 * settlement check that is permanently green and quietly stops being true the
 * day PAY1 lands. B2 owns the behaviour.
 *
 * What B1 gets by defining the shape now is that B2 is additive — the agreement
 * already carries `notice_period_days`, and the six states are named where the
 * agreement lifecycle can be read alongside them.
 *
 * The six states (appendix C, B.6): `requested → notice_served →
 * settlement_pending → signed_off → revoking → completed`. `revoking` is
 * separate from `completed` on purpose: revoking every member's access is the
 * step that can partially fail, and a status that collapsed it into the
 * terminal state would make a half-revoked organisation look finished.
 *
 * Isolation strategy: **`org-rls`** in vocabulary, unimplemented in B1 for the
 * same reason as everything else here — B2 adds the policy in the commit that
 * adds the read path.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('b2b_offboardings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('b2b_agreement_id')->nullable()->constrained('b2b_agreements')->nullOnDelete();

            $table->string('status', 24)->default('requested');
            $table->string('reason', 40)->nullable()->comment('vocabulary deferred to B2 — the reason list is a product decision, not a schema one');
            $table->text('reason_note')->nullable();

            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('requested_at');
            $table->smallInteger('notice_period_days')->nullable()->comment('copied from the agreement at request time, so a later amendment cannot shorten notice already served');
            $table->timestamp('notice_served_at')->nullable();
            $table->date('effective_on')->nullable();

            $table->text('settlement_note')->nullable()->comment('honest placeholder: no invoicing exists to settle against until PAY1');
            $table->timestamp('signed_off_at')->nullable();
            $table->foreignUuid('signed_off_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('revocation_started_at')->nullable();
            $table->integer('memberships_revoked')->nullable();
            $table->timestamp('completed_at')->nullable();

            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->index(['organisation_id', 'status']);
        });

        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_status_check CHECK (status IN ('requested', 'notice_served', 'settlement_pending', 'signed_off', 'revoking', 'completed'))");
        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_completed_check CHECK (status <> 'completed' OR completed_at IS NOT NULL)");

        // One offboarding in flight per organisation.
        DB::statement("CREATE UNIQUE INDEX b2b_offboardings_open_unique ON b2b_offboardings (organisation_id) WHERE status <> 'completed'");
    }

    public function down(): void
    {
        Schema::dropIfExists('b2b_offboardings');
    }
};
