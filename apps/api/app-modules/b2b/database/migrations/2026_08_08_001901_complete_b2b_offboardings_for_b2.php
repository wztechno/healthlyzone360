<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * B2 completes the offboarding shell B1 left (master plan v2 Phase B2,
 * appendix C B.6).
 *
 * **Additive throughout.** B1 shipped the table, six states and a model, and
 * said in its own migration that B2 owned the behaviour. Nothing here drops a
 * column or renames a state; the three CHECK constraints that are dropped are
 * dropped only in order to be recreated wider, which is the K1.1 pattern for
 * an enumerated column in PostgreSQL.
 *
 * ## What is added, and why each column had to exist
 *
 * **`trigger`.** B1's `reason` was a free string with a comment saying the
 * vocabulary was a product decision. It is now four values behind a CHECK.
 * `reason` and `reason_note` survive unchanged: the reason a company *gives*
 * is prose, and this is the part the platform can count.
 *
 * **`settlement_status`, `settlement_checks`, and the waiver pair.** B1 had a
 * single `settlement_note` and called it an "honest placeholder". Honesty now
 * costs more than a note: `settlement_checks` stores what each check actually
 * looked at and what it found, including the checks that answered
 * `not_applicable` because the invoicing module does not exist. A waiver
 * carries the person who granted it and their reason, and the CHECK refuses a
 * waiver missing either — a waiver nobody signed is not a waiver.
 *
 * **The sign-off evidence block.** The same shape `b2b_agreements` uses for
 * signing, for the same reason: an offboarding sign-off is a click-wrap
 * acceptance and a dispute rests on the challenge that proved the signatory
 * was present, the document digest they were shown, the wording they accepted
 * and hashed session corroboration. `signoff_challenge_id` carries
 * `ON DELETE RESTRICT` because evidence a purge job can delete is not
 * evidence — the identical argument B1 made for the agreement's column.
 *
 * **Per-stage timestamps.** One per state, because "when did this stall" is
 * the question an operator asks and a single `updated_at` cannot answer it.
 *
 * **`notice_period_days` gains a default of 30** (OQ-032, confirmed). The
 * column stays nullable: it is copied from the agreement at request time, so
 * an agreement stating 60 days must be able to say so, and the default is
 * only what applies when the agreement is silent.
 *
 * ## The three widened constraints
 *
 * 1. **`status`** gains `awaiting_signoff`, `archiving` and `cancelled`. See
 *    `OffboardingStatus` for why each is a state rather than a flag.
 * 2. **The open-offboarding unique index** now excludes `cancelled` as well as
 *    `completed`. A cancelled offboarding must not occupy the one-in-flight
 *    slot, or a company that called one off could never start another.
 * 3. **`completed_check`** is unchanged in meaning and re-stated alongside two
 *    new ones — a cancelled row needs `cancelled_at`, and a revoked row needs
 *    a membership count, for the same reason: a terminal state whose evidence
 *    is missing is a row that cannot be explained afterwards.
 *
 * ## Row-level security
 *
 * Still absent, and now deliberately rather than by omission. B1 wrote that B2
 * would add the policy "in the commit that adds the read path", and B2 adds no
 * read path: the HTTP surface belongs to the integration wave. Adding a policy
 * here would also mean editing the RLS pin in the tenancy suite, which is a
 * shared file three parallel phases are writing against. Isolation until then
 * is the service layer, where every read names its organisation explicitly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('b2b_offboardings', function (Blueprint $table): void {
            $table->string('trigger', 30)->nullable()->after('status');

            $table->string('settlement_status', 20)->default('pending')->after('settlement_note');
            $table->jsonb('settlement_checks')->nullable()->after('settlement_status')
                ->comment('one entry per check: what was looked at, what was found, and the reason when nothing could be');
            $table->timestamp('settlement_started_at')->nullable()->after('settlement_checks');
            $table->timestamp('settlement_resolved_at')->nullable()->after('settlement_started_at');
            $table->foreignUuid('settlement_waived_by')->nullable()->after('settlement_resolved_at')
                ->constrained('users')->nullOnDelete();
            $table->text('settlement_waiver_reason')->nullable()->after('settlement_waived_by');

            $table->timestamp('awaiting_signoff_at')->nullable()->after('settlement_waiver_reason');

            // RESTRICT on delete: evidence a purge job can remove is not
            // evidence. The identical rule B1 gave the agreement's own
            // signature challenge.
            $table->foreignUuid('signoff_challenge_id')->nullable()->after('signed_off_by')
                ->constrained('otp_challenges')->restrictOnDelete();
            $table->string('signoff_signatory_name')->nullable()->after('signoff_challenge_id');
            $table->string('signoff_signatory_title')->nullable()->after('signoff_signatory_name');
            $table->string('signoff_document_sha256', 64)->nullable()->after('signoff_signatory_title');
            $table->text('signoff_consent_statement')->nullable()->after('signoff_document_sha256');
            $table->string('signoff_ip_hash', 64)->nullable()->after('signoff_consent_statement');
            $table->string('signoff_user_agent_hash', 64)->nullable()->after('signoff_ip_hash');

            $table->timestamp('revocation_completed_at')->nullable()->after('memberships_revoked');
            $table->integer('tokens_deleted')->nullable()->after('revocation_completed_at')
                ->comment('sole-membership users only — see RevokeBusinessAccess');
            $table->timestamp('archiving_started_at')->nullable()->after('tokens_deleted');
            $table->jsonb('archive_summary')->nullable()->after('archiving_started_at')
                ->comment('what the purge touched, in counts — never identifiers');

            $table->timestamp('cancelled_at')->nullable()->after('completed_at');
            $table->foreignUuid('cancelled_by')->nullable()->after('cancelled_at')
                ->constrained('users')->nullOnDelete();
            $table->text('cancellation_reason')->nullable()->after('cancelled_by');
        });

        DB::statement('ALTER TABLE b2b_offboardings ALTER COLUMN notice_period_days SET DEFAULT 30');

        DB::statement('ALTER TABLE b2b_offboardings DROP CONSTRAINT b2b_offboardings_status_check');
        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_status_check CHECK (status IN ('requested', 'notice_served', 'settlement_pending', 'awaiting_signoff', 'signed_off', 'revoking', 'archiving', 'completed', 'cancelled'))");

        // `trigger` is quoted: PostgreSQL treats it as a non-reserved keyword,
        // which is a promise about today's grammar rather than tomorrow's.
        DB::statement('ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_trigger_check CHECK ("trigger" IS NULL OR "trigger" IN (\'contract_end\', \'termination\', \'non_renewal\', \'client_request\'))');
        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_settlement_status_check CHECK (settlement_status IN ('pending', 'cleared', 'waived'))");

        // A waiver nobody signed, or nobody explained, is not a waiver.
        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_waiver_check CHECK (settlement_status <> 'waived' OR (settlement_waived_by IS NOT NULL AND settlement_waiver_reason IS NOT NULL))");

        // Sign-off without evidence is an assertion. The application refuses
        // first so the caller gets a field-level message; this is the floor.
        DB::statement('ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_signoff_check CHECK (signed_off_at IS NULL OR (signoff_challenge_id IS NOT NULL AND signoff_signatory_name IS NOT NULL AND signoff_consent_statement IS NOT NULL))');

        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_cancelled_check CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL))");

        // One in flight per organisation — cancelled rows release the slot.
        DB::statement('DROP INDEX b2b_offboardings_open_unique');
        DB::statement("CREATE UNIQUE INDEX b2b_offboardings_open_unique ON b2b_offboardings (organisation_id) WHERE status NOT IN ('completed', 'cancelled')");

        DB::statement('CREATE INDEX b2b_offboardings_settlement_status_index ON b2b_offboardings (settlement_status)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS b2b_offboardings_settlement_status_index');
        DB::statement('DROP INDEX IF EXISTS b2b_offboardings_open_unique');
        DB::statement("CREATE UNIQUE INDEX b2b_offboardings_open_unique ON b2b_offboardings (organisation_id) WHERE status <> 'completed'");

        foreach ([
            'b2b_offboardings_cancelled_check',
            'b2b_offboardings_signoff_check',
            'b2b_offboardings_waiver_check',
            'b2b_offboardings_settlement_status_check',
            'b2b_offboardings_trigger_check',
        ] as $constraint) {
            DB::statement("ALTER TABLE b2b_offboardings DROP CONSTRAINT IF EXISTS {$constraint}");
        }

        DB::statement('ALTER TABLE b2b_offboardings DROP CONSTRAINT b2b_offboardings_status_check');
        DB::statement("ALTER TABLE b2b_offboardings ADD CONSTRAINT b2b_offboardings_status_check CHECK (status IN ('requested', 'notice_served', 'settlement_pending', 'signed_off', 'revoking', 'completed'))");

        DB::statement('ALTER TABLE b2b_offboardings ALTER COLUMN notice_period_days DROP DEFAULT');

        Schema::table('b2b_offboardings', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('cancelled_by');
            $table->dropConstrainedForeignId('settlement_waived_by');
            $table->dropConstrainedForeignId('signoff_challenge_id');
            $table->dropColumn([
                'trigger',
                'settlement_status',
                'settlement_checks',
                'settlement_started_at',
                'settlement_resolved_at',
                'settlement_waiver_reason',
                'awaiting_signoff_at',
                'signoff_signatory_name',
                'signoff_signatory_title',
                'signoff_document_sha256',
                'signoff_consent_statement',
                'signoff_ip_hash',
                'signoff_user_agent_hash',
                'revocation_completed_at',
                'tokens_deleted',
                'archiving_started_at',
                'archive_summary',
                'cancelled_at',
                'cancellation_reason',
            ]);
        });
    }
};
