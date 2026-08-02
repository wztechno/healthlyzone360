<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A company asking to buy from the platform, and the record of what it told
 * us while asking.
 *
 * **The applicant is a real registered person** (`applicant_user_id`, not
 * null). Appendix C's B.5 journey is register-first for a reason worth
 * restating: an application carries an identity document, a signatory's name
 * and a company's registration number, and accepting that from an anonymous
 * form means anybody can file paperwork in somebody else's company's name and
 * then never be found. The applicant holds no organisation yet — the
 * corporate organisation is *created by approval*, not before it — so this
 * table is deliberately not tenant-scoped and carries no `organisation_id`.
 * That is the whole shape of the phase: a B2B application is the thing that
 * exists before a tenant does.
 *
 * `restrictOnDelete` on the applicant rather than a cascade. An approved or
 * declined application is a business record about a commitment somebody made;
 * it must not evaporate because an identity row was removed. J2's closure
 * anonymises users rather than deleting them (master plan v2 §7, appendix C
 * B.2), so the restriction never blocks the closure path — it blocks the
 * thing that would be a mistake.
 *
 * **The seven states** are `draft → submitted → in_review → info_requested →
 * approved | declined | withdrawn`, and the transitions live in
 * `ApplicationService`. Two are enforced structurally here rather than left to
 * the service, because a state that lies about its own history is worse than a
 * refused transition: a decided application must carry `decided_at`, and
 * anything past `draft`/`withdrawn` must carry `submitted_at`.
 *
 * **The sheet-4 field groups** (appendix A, "Customer Data Structure" — B2B
 * field spec) are columns rather than a JSON blob, grouped by the section a
 * wizard step PATCHes: company, signatory, trade terms, logistics. Typed
 * columns because these are the fields a duplicate check, a reviewer's queue
 * and a provisioning transaction all read, and reading them out of JSON means
 * every one of those learns the shape by heart. `completed_sections` records
 * which steps the applicant has finished, and it is the applicant's progress
 * claim — not the server's readiness verdict. Submit-readiness is *computed*
 * by the service from the data actually present, the same asymmetry §4.7 draws
 * between a stored state and a readiness evaluator.
 *
 * **No bank details** (master plan v2 Phase B1, explicit gate). No IBAN, no
 * account number, no card. The encryption, key-management and retention policy
 * that would have to exist first does not, and a nullable column would be an
 * invitation to fill it before it does.
 *
 * **Duplicate matching is surfaced, never enforced.** The commercial
 * registration and tax numbers each carry a `_normalised` twin — digits and
 * letters only, uppercased — and both are indexed but **not unique**. A second
 * application against the same registration is a routine thing: a company
 * whose first attempt was declined for a fixable reason, a franchise group, a
 * re-application after a lapsed licence. The reviewer is told; the platform
 * does not decide. `duplicate_of_application_id` is set only by a human
 * confirming it.
 *
 * Isolation strategy: **`platform-only`** for the review surface plus
 * applicant-owned reads for the applicant's own row — not `org-rls`, which
 * cannot apply to a table whose rows exist precisely because no organisation
 * does yet. No PostgreSQL policy joins the set in B1, and that is a decision
 * rather than an omission: `RlsTest` pins the protected set, so this table's
 * absence from it is stated. The service is the boundary — every read is
 * either "the row this user filed" or "a platform reviewer", and there is no
 * tenant session variable that could express either.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('b2b_applications', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->string('reference', 24)->comment('human-quotable; what a support ticket and a reviewer both name');
            // Register-first: the person who filed it, never anonymous.
            $table->foreignUuid('applicant_user_id')->constrained('users')->restrictOnDelete();
            $table->string('status', 20)->default('draft');

            // ── Section: company ─────────────────────────────────────────────
            $table->string('legal_name', 160)->nullable()->comment('as written on the commercial registration');
            $table->string('legal_name_ar', 160)->nullable();
            $table->string('trading_name', 160)->nullable();
            $table->string('business_type', 40)->nullable()->comment('sheet-4 Business Type list — a vocabulary value, not an FK: the list is a dropdown the source owns, not a platform entity');
            $table->string('country_code', 2)->nullable();
            $table->string('commercial_registration_number', 60)->nullable();
            $table->string('commercial_registration_normalised', 60)->nullable()->comment('alphanumerics only, uppercased — what duplicate matching compares');
            $table->string('tax_registration_number', 60)->nullable()->comment('VAT/TRN as written');
            $table->string('tax_registration_normalised', 60)->nullable();
            $table->date('incorporated_on')->nullable();
            $table->string('website', 200)->nullable();

            // ── Section: signatory ───────────────────────────────────────────
            $table->string('signatory_name', 120)->nullable()->comment('the person authorised to bind the company');
            $table->string('signatory_title', 120)->nullable();
            $table->string('signatory_email', 160)->nullable();
            $table->string('signatory_phone', 32)->nullable();

            // ── Section: trade terms requested ───────────────────────────────
            $table->string('requested_payment_terms', 20)->nullable()->comment('prepaid | net_15 | net_30 | net_60 — requested, never granted here');
            $table->bigInteger('requested_credit_limit_minor')->nullable()->comment('minor units of currency_code; an ask, not a limit');
            $table->string('currency_code', 3)->nullable();
            $table->string('expected_volume_band', 30)->nullable()->comment('sheet-4 Volume Band list');
            $table->string('expected_order_frequency', 30)->nullable()->comment('sheet-4 Order Frequency list');
            $table->jsonb('product_categories')->nullable()->comment('sheet-4 B2B Product Categories — a list of vocabulary strings');

            // ── Section: logistics ───────────────────────────────────────────
            $table->string('preferred_delivery_window', 40)->nullable();
            $table->smallInteger('lead_time_days')->nullable();
            $table->boolean('requires_invoice_per_location')->default(false);
            $table->text('delivery_notes')->nullable();

            // ── Progress and workflow ────────────────────────────────────────
            $table->jsonb('completed_sections')->default(DB::raw("'[]'::jsonb"))
                ->comment("the applicant's progress claim, not the server's readiness verdict");
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('review_started_at')->nullable();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->text('decision_note')->nullable()->comment('internal — reviewer commentary is on the public denylist (§4.8)');
            $table->text('applicant_message')->nullable()->comment('the half of a decision the applicant is shown');
            $table->timestamp('information_requested_at')->nullable();
            $table->text('information_request')->nullable()->comment('what the reviewer asked for — shown to the applicant');
            $table->jsonb('information_requested_sections')->nullable()->comment('which sections reopen for editing');
            $table->timestamp('withdrawn_at')->nullable();
            // Constrained after creation: the primary key it references does
            // not exist yet inside the CREATE TABLE statement.
            $table->uuid('duplicate_of_application_id')->nullable()
                ->comment('set only by a human confirming it; matching surfaces, it never decides');

            $table->integer('lock_version')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign('country_code')->references('code')->on('countries')->restrictOnDelete();
            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique('reference');
            $table->index(['status', 'submitted_at']);
            $table->index(['applicant_user_id', 'status']);
            $table->index('commercial_registration_normalised');
            $table->index('tax_registration_normalised');
        });

        Schema::table('b2b_applications', function (Blueprint $table): void {
            $table->foreign('duplicate_of_application_id')->references('id')->on('b2b_applications')->nullOnDelete();
        });

        DB::statement("ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_status_check CHECK (status IN ('draft', 'submitted', 'in_review', 'info_requested', 'approved', 'declined', 'withdrawn'))");
        DB::statement("ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_payment_terms_check CHECK (requested_payment_terms IS NULL OR requested_payment_terms IN ('prepaid', 'net_15', 'net_30', 'net_60'))");
        DB::statement('ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_credit_limit_check CHECK (requested_credit_limit_minor IS NULL OR requested_credit_limit_minor >= 0)');
        DB::statement('ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_lead_time_check CHECK (lead_time_days IS NULL OR lead_time_days >= 0)');

        // A decision has a date, and anything past draft has been submitted.
        // Structural rather than service-enforced: a state that cannot say
        // when it happened is not a record of anything.
        DB::statement("ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_decided_check CHECK (status NOT IN ('approved', 'declined') OR decided_at IS NOT NULL)");
        DB::statement("ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_submitted_check CHECK (status IN ('draft', 'withdrawn') OR submitted_at IS NOT NULL)");

        // An application cannot be its own duplicate.
        DB::statement('ALTER TABLE b2b_applications ADD CONSTRAINT b2b_applications_duplicate_self_check CHECK (duplicate_of_application_id IS NULL OR duplicate_of_application_id <> id)');

        // One live application per applicant. Partial, because the terminal
        // states must be allowed to accumulate: a company declined in March
        // and re-applying in June is the case this table most needs to
        // support, and a whole-table unique index would forbid it.
        DB::statement("CREATE UNIQUE INDEX b2b_applications_live_per_applicant_unique ON b2b_applications (applicant_user_id) WHERE status IN ('draft', 'submitted', 'in_review', 'info_requested')");
    }

    public function down(): void
    {
        Schema::dropIfExists('b2b_applications');
    }
};
