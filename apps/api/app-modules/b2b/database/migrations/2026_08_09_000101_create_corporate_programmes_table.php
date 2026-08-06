<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A corporate buyer's standing arrangement with one seller kitchen — the
 * thing a quotation is drafted against (B1).
 *
 * **Linked to exactly one signed `b2b_agreements` row, never invented by
 * renaming one.** The agreement is the commercial and legal relationship —
 * terms, credit limit, the negotiated price list; the programme is the
 * narrower, named thing a buyer's staff actually work inside — "Acme Q3
 * wellness programme" — and B1 draws that line deliberately rather than
 * letting a screen simply relabel the agreement.
 *
 * `kitchen_organisation_id` is denormalised from the agreement rather than
 * joined through `price_lists` on every read. `BuyerAgreementLookup` already
 * establishes the rule this column states as a fact: a buyer's active
 * agreement carries a `price_list_id`, and that list's `organisation_id` is
 * the one kitchen the agreement's tariff was negotiated with. `B10` (single
 * seller kitchen per programme) is exactly that fact, named once at creation
 * so every later read — including the seven-day expiry sweep — answers "who
 * supplies this" without re-deriving it through the pricing module.
 *
 * Isolation strategy: **`org-rls`** in vocabulary, **app-scope** in this
 * phase — the `price_lists` / `subscriptions` precedent (data-register D-047,
 * RlsTest's "final backend wave" note). A PostgreSQL policy would fail the
 * seven-day expiry sweep silently: that job runs platform-wide with no
 * `X-Organisation-Id` published, exactly like `GenerationService::tick()` and
 * `ProcessScheduledClosures`, and a policy would show it nothing rather than
 * everything. `BelongsToOrganisation` gives every request-driven read its
 * scope; the sweep gets its own with an explicit `organisation_id` predicate,
 * the same shape `SubscriptionLocator` uses.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('corporate_programmes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->comment('the buyer')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('kitchen_organisation_id')->comment('the single seller kitchen, denormalised from the agreement price list')->constrained('organisations')->restrictOnDelete();
            $table->foreignUuid('b2b_agreement_id')->constrained('b2b_agreements')->restrictOnDelete();

            $table->string('code', 60);
            $table->string('name_en', 160);
            $table->string('name_ar', 160);
            $table->text('description')->nullable();
            $table->string('status', 20)->default('active')->comment('active | archived');

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index('kitchen_organisation_id');
            $table->index('b2b_agreement_id');
        });

        DB::statement("ALTER TABLE corporate_programmes ADD CONSTRAINT corporate_programmes_status_check CHECK (status IN ('active', 'archived'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('corporate_programmes');
    }
};
