<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two seams on the agreement, closed together because they are the same
 * decision seen from either end: what the agreement governs, and what proves
 * somebody agreed to it.
 *
 * **`organisation_id`** is stamped by provisioning. Until an application is
 * approved an agreement governs nothing — there is no counterparty yet — so
 * the column is nullable and the isolation vocabulary moves from
 * `platform-only` to `org-rls` the moment it is set. It is `nullOnDelete`: an
 * organisation that is deleted must not silently erase the contract it signed.
 *
 * **`signature_otp_challenge_id`** stops being a bare uuid and becomes a real
 * foreign key into `otp_challenges`. B1 shipped it unconstrained because the
 * verification module owned the other end and nothing had wired the purpose
 * yet; that wiring lands here, and with it the rule that makes the evidence
 * worth keeping: `AgreementService::sign()` now *requires* a verified
 * challenge of purpose `b2b_signatory`, consumed, whose subject matches the
 * agreement's signatory. `SigningEvidence::$otpVerified` can only be true when
 * one exists.
 *
 * The `restrictOnDelete` is deliberate and is the whole point. Signature
 * evidence that can be deleted by a challenge-purge job is not evidence, so
 * the purge cannot reach a challenge an agreement points at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('b2b_agreements', function (Blueprint $table): void {
            $table->foreignUuid('organisation_id')->nullable()->after('b2b_application_id')
                ->comment('set by provisioning; the counterparty this agreement governs')
                ->constrained('organisations')->nullOnDelete();
        });

        $table = 'b2b_agreements';

        // The column already exists as an unconstrained uuid (B1's declared
        // seam). Adding the constraint rather than the column keeps every row
        // written so far intact.
        DB::statement("ALTER TABLE {$table} ADD CONSTRAINT b2b_agreements_signature_otp_challenge_id_foreign FOREIGN KEY (signature_otp_challenge_id) REFERENCES otp_challenges (id) ON DELETE RESTRICT");

        DB::statement("CREATE INDEX b2b_agreements_organisation_status_index ON {$table} (organisation_id, status)");

        // A signed agreement carries its challenge. The click-wrap evidence
        // check already demands the document hash, the name, the title and the
        // consent statement; this adds the one thing that makes them mean
        // something — proof the signatory was present when it was written.
        DB::statement("ALTER TABLE {$table} ADD CONSTRAINT b2b_agreements_signature_challenge_check CHECK (signed_at IS NULL OR signature_otp_challenge_id IS NOT NULL)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE b2b_agreements DROP CONSTRAINT IF EXISTS b2b_agreements_signature_challenge_check');
        DB::statement('DROP INDEX IF EXISTS b2b_agreements_organisation_status_index');
        DB::statement('ALTER TABLE b2b_agreements DROP CONSTRAINT IF EXISTS b2b_agreements_signature_otp_challenge_id_foreign');

        Schema::table('b2b_agreements', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('organisation_id');
        });
    }
};
