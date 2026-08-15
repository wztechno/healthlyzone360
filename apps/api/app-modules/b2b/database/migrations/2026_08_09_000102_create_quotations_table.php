<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A real backend resource for one round of "what would this cost" between a
 * corporate buyer and the programme's kitchen (B3), never a note attached to
 * something else.
 *
 * `draft → submitted → quoted → accepted | declined | expired`. The buyer
 * drafts lines (B4); the kitchen or platform prices the submitted set; the
 * buyer accepts or declines what comes back; a quotation left `quoted` for
 * seven days expires on its own (B5, `ExpireQuotations`). `QuotationStatus`
 * carries the transition table.
 *
 * `organisation_id` is the buyer, denormalised from the parent programme
 * rather than joined for it on every read — the same argument
 * `corporate_programmes` makes for `kitchen_organisation_id`.
 *
 * `currency_code` is copied from the programme's agreement at creation
 * (§4.4: an amount means nothing without one) rather than left null until
 * quoting — a draft's lines already carry a quantity in a real unit, and the
 * currency they will eventually be priced in is not a fact that changes
 * between drafting and quoting.
 *
 * `expires_at` is written once, when `quoted_at` is: `quoted_at + 7 days`,
 * computed at the moment of quoting rather than derived on every read, so the
 * sweep is a plain `WHERE expires_at <= now()` rather than an interval
 * calculation repeated per row.
 *
 * Isolation strategy: **`org-rls`** in vocabulary, **app-scope** in this
 * phase — the same choice `corporate_programmes` makes and for the same
 * reason: `ExpireQuotations` sweeps every organisation on a schedule with no
 * tenant context published, which is exactly the shape the `subscriptions` /
 * `account_closure_requests` precedent (RlsTest) declined a policy for.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->comment('the buyer, denormalised from the programme')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('corporate_programme_id')->constrained('corporate_programmes')->restrictOnDelete();

            $table->string('reference', 40)->unique();
            $table->string('status', 20)->default('draft')->comment('draft | submitted | quoted | accepted | declined | expired');
            $table->string('currency_code', 3);

            $table->text('notes')->nullable()->comment("the buyer's covering note, submitted with the draft");
            $table->text('decline_reason')->nullable();

            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('quoted_at')->nullable();
            $table->timestamp('expires_at')->nullable()->comment('quoted_at + 7 days, written once at quoting time');
            $table->timestamp('decided_at')->nullable()->comment('accepted or declined');

            $table->foreignUuid('submitted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('quoted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->index(['corporate_programme_id', 'status']);
            $table->index(['organisation_id', 'status']);
            $table->index('expires_at');
        });

        DB::statement("ALTER TABLE quotations ADD CONSTRAINT quotations_status_check CHECK (status IN ('draft', 'submitted', 'quoted', 'accepted', 'declined', 'expired'))");

        // A quotation carries the evidence of the stage it claims to be at —
        // the same discipline b2b_agreements' signature CHECK enforces.
        DB::statement('ALTER TABLE quotations ADD CONSTRAINT quotations_submitted_evidence_check CHECK (submitted_at IS NOT NULL OR status = \'draft\')');
        DB::statement('ALTER TABLE quotations ADD CONSTRAINT quotations_quoted_evidence_check CHECK (quoted_at IS NOT NULL OR status NOT IN (\'quoted\', \'accepted\', \'declined\', \'expired\'))');
        DB::statement('ALTER TABLE quotations ADD CONSTRAINT quotations_decided_evidence_check CHECK ((decided_at IS NOT NULL) = (status IN (\'accepted\', \'declined\')))');
        DB::statement('ALTER TABLE quotations ADD CONSTRAINT quotations_expiry_evidence_check CHECK (expires_at IS NOT NULL OR status NOT IN (\'quoted\', \'accepted\', \'declined\', \'expired\'))');
    }

    public function down(): void
    {
        Schema::dropIfExists('quotations');
    }
};
