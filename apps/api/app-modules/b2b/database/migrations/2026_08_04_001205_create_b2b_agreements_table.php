<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The commercial agreement between the platform and a corporate buyer — the
 * terms, the version, and the evidence that somebody accepted them.
 *
 * **Versioned, and an active version is immutable.** A change of terms is a
 * new version that supersedes the old one, never an edit of a document
 * somebody has already accepted. That is the same rule published recipe
 * versions follow (§4.7) and it exists for the same reason: what a
 * counterparty was shown must stay reconstructable. `supersedes_agreement_id`
 * is the chain; `(b2b_application_id, version)` is unique.
 *
 * **Anchored to the application, not to an organisation.** The corporate
 * organisation is created by provisioning, which is the integrator wave's
 * transaction — see the seam note at the end. Until then the agreement hangs
 * off the application that produced it, which is also the honest reading of
 * the timeline: terms are agreed *in order to* create the relationship.
 *
 * ## The signature, described honestly
 *
 * This is **click-wrap evidence, not a qualified electronic signature**, and
 * the schema is shaped so nothing can imply otherwise. There is no certificate
 * column, no signing-authority column, and no `signature` blob that could be
 * mistaken for a cryptographic one. What is recorded is what actually
 * happened:
 *
 *  * `signature_document_sha256` — the digest of the exact bytes the signatory
 *    was shown. Without it, "they accepted the terms" cannot say *which*
 *    terms, which is the failure mode that makes click-wrap worthless in a
 *    dispute.
 *  * `signatory_name` / `signatory_title` — typed by the person, and the
 *    claim they are making about their own authority to bind the company.
 *  * `signature_consent_statement` — the wording they clicked, verbatim.
 *  * `signature_ip_hash` / `signature_user_agent_hash` — hashed, not raw. They
 *    exist to corroborate one session against another, which a hash does; the
 *    raw values would be personal data retained for no additional purpose.
 *  * `signature_otp_challenge_id` — a **nullable uuid with no foreign key**.
 *    The OTP challenge that stepped the signatory up lives in the verification
 *    module, built in parallel with this one (J1). A column with no constraint
 *    is a deliberately incomplete join, recorded as a seam rather than
 *    invented: the integrator adds the FK when both halves exist, and
 *    `AgreementService::sign()` does not verify a challenge in B1 and says so.
 *
 * INT-007 is the register entry for real e-signature integration. Nothing here
 * anticipates it beyond leaving room.
 *
 * **The evidence constraint is structural.** `signed_at` cannot be set without
 * the document digest and the signatory's name and title. A signature record
 * missing its evidence is worse than no record, because it looks like proof.
 * Likewise `active` implies `signed_at`: an agreement in force that nobody
 * signed is not an agreement.
 *
 * `price_list_id` is the commercial half — the negotiated tariff this buyer
 * gets. It points at a `price_lists` row whose `customer_scope` is
 * `agreement`, which is the confidentiality boundary K1.5 drew: one buyer's
 * negotiated position must never be visible to another. The service checks the
 * scope; the leak test is B1's frontend/integration work.
 *
 * Isolation strategy: **`platform-only`** in B1 (the agreement is drafted and
 * decided by the platform, and its application parent has no tenant), moving
 * to `org-rls` when the provisioning wave adds `organisation_id`. Named here
 * so that addition is a widening rather than a rethink.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('b2b_agreements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('b2b_application_id')->constrained('b2b_applications')->restrictOnDelete();

            $table->integer('version')->default(1);
            // Constrained after creation — a self-reference cannot be added
            // inside the CREATE TABLE that defines the key it points at.
            $table->uuid('supersedes_agreement_id')->nullable();
            $table->string('status', 24)->default('draft');

            // ── Terms ────────────────────────────────────────────────────────
            $table->string('title', 160);
            $table->string('currency_code', 3)->nullable();
            // The negotiated tariff. `AgreementService` refuses anything whose
            // `customer_scope` is not `agreement` — see the class comment.
            $table->foreignUuid('price_list_id')->nullable()->constrained('price_lists')->nullOnDelete();
            $table->string('payment_terms', 20)->nullable()->comment('prepaid | net_15 | net_30 | net_60 — granted, unlike the application column');
            $table->bigInteger('credit_limit_minor')->nullable();
            $table->bigInteger('minimum_order_minor')->nullable();
            $table->smallInteger('delivery_lead_time_days')->nullable();
            $table->smallInteger('notice_period_days')->nullable()->comment('what B2 offboarding will honour');
            $table->date('starts_on')->nullable();
            $table->date('ends_on')->nullable();
            $table->boolean('auto_renews')->default(false);
            $table->text('terms_summary')->nullable()->comment('the human-readable précis; the document itself is a kyc_documents row of kind signed_agreement');

            // ── Click-wrap evidence (never a qualified signature) ────────────
            $table->char('signature_document_sha256', 64)->nullable()->comment('digest of the exact bytes the signatory was shown');
            $table->string('signatory_name', 120)->nullable();
            $table->string('signatory_title', 120)->nullable();
            $table->foreignUuid('signatory_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('signature_consent_statement')->nullable()->comment('the wording accepted, verbatim');
            $table->char('signature_ip_hash', 64)->nullable()->comment('hashed — corroboration, not surveillance');
            $table->char('signature_user_agent_hash', 64)->nullable();
            $table->uuid('signature_otp_challenge_id')->nullable()
                ->comment('SEAM: no FK — otp_challenges is the parallel verification module. The integrator adds the constraint and the verification check');
            $table->timestamp('signed_at')->nullable();

            // ── Lifecycle ────────────────────────────────────────────────────
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('suspended_at')->nullable();
            $table->timestamp('terminated_at')->nullable();
            $table->string('termination_reason', 40)->nullable();

            $table->integer('lock_version')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique(['b2b_application_id', 'version']);
            $table->index(['status', 'starts_on']);
        });

        Schema::table('b2b_agreements', function (Blueprint $table): void {
            $table->foreign('supersedes_agreement_id')->references('id')->on('b2b_agreements')->nullOnDelete();
        });

        DB::statement("ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_status_check CHECK (status IN ('draft', 'pending_signature', 'active', 'suspended', 'terminated'))");
        DB::statement("ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_payment_terms_check CHECK (payment_terms IS NULL OR payment_terms IN ('prepaid', 'net_15', 'net_30', 'net_60'))");
        DB::statement('ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_version_check CHECK (version >= 1)');
        DB::statement('ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_amounts_check CHECK ((credit_limit_minor IS NULL OR credit_limit_minor >= 0) AND (minimum_order_minor IS NULL OR minimum_order_minor >= 0))');
        DB::statement('ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_window_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)');
        DB::statement('ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_supersedes_self_check CHECK (supersedes_agreement_id IS NULL OR supersedes_agreement_id <> id)');

        // Money needs a currency to mean anything (§4.4).
        DB::statement('ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_currency_check CHECK ((credit_limit_minor IS NULL AND minimum_order_minor IS NULL) OR currency_code IS NOT NULL)');

        // A signature without its evidence looks like proof and is not.
        DB::statement('ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_signature_evidence_check CHECK (signed_at IS NULL OR (signature_document_sha256 IS NOT NULL AND signatory_name IS NOT NULL AND signatory_title IS NOT NULL AND signature_consent_statement IS NOT NULL))');

        // An agreement in force was signed. Suspension and termination follow
        // from having been active, so they carry the requirement too.
        DB::statement("ALTER TABLE b2b_agreements ADD CONSTRAINT b2b_agreements_active_signed_check CHECK (status NOT IN ('active', 'suspended') OR signed_at IS NOT NULL)");

        // One agreement in force per application at a time. Superseding is a
        // transition, not an accumulation.
        DB::statement("CREATE UNIQUE INDEX b2b_agreements_active_unique ON b2b_agreements (b2b_application_id) WHERE status = 'active'");
    }

    public function down(): void
    {
        Schema::dropIfExists('b2b_agreements');
    }
};
