<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A named set of prices an organisation quotes — its web-shop tariff, its
 * wholesale sheet, the tariff negotiated with one corporate client.
 *
 * **The currency lives here, not on the row** (master plan v2 §4.4). Every
 * amount inside a list is denominated in the list's `currency_code`, so a
 * total is a sum of comparable numbers by construction and there is no
 * cross-currency arithmetic to arch-test away. A kitchen that sells in two
 * currencies keeps two lists, which is what it actually has: two tariffs, not
 * one tariff with mixed money in it. The currency becomes immutable the moment
 * the list has its first item row — the service refuses the change with
 * `409 resource.conflict` rather than re-denominating history that was
 * negotiated in the old currency.
 *
 * `customer_scope` is `public | agreement` and it is the confidentiality
 * boundary this table draws. A `public` list is the tariff anybody may be
 * shown; an `agreement` list is one customer's negotiated position, and
 * showing it to a second customer is the commercial failure this whole slice
 * is built to prevent. It is a column rather than an inference from the
 * channel kind because the same channel can carry both.
 *
 * `status` is `draft | active | archived` — **operational, not the sellable
 * family**, the same asymmetry `catalogue_item_variants` draws. A price list
 * is not published content; it is the instrument that prices content. What a
 * customer sees is a *price*, and whether one reaches them is decided by the
 * channel assignment plus the public projection, never by a lifecycle badge on
 * the tariff.
 *
 * `valid_from` / `valid_to` are the list's own window and are **inclusive at
 * both ends**: a human writing "valid to 30 June" means through the 30th.
 * That is deliberately not the convention `price_list_items.effective_to`
 * uses — see that migration for why a machine-written supersession boundary
 * has to be exclusive. Two conventions, each right for who writes it.
 *
 * `branch_id` is nullable and usually null. A tariff is normally an
 * organisation-wide instrument; naming a branch is for the case a kitchen
 * genuinely prices one location differently, and modelling that as a separate
 * list rather than a per-branch override keeps one answer to "what does this
 * cost here".
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope** in K1.5 — a list
 * *header* is a name, a currency and a status, and the negotiated numbers
 * that need a PostgreSQL policy are one table over in `price_list_items`,
 * which does carry one (appendix D).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_lists', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('organisation_branches')->nullOnDelete();
            $table->string('code', 40);
            $table->string('name_en');
            $table->string('name_ar');
            $table->string('currency_code', 3)->comment('ISO 4217 — every amount in this list is denominated in it; immutable once any item row exists');
            $table->string('customer_scope', 20)->default('public')->comment('public | agreement — an agreement list is one customer negotiated position');
            $table->string('status', 20)->default('draft')->comment('draft | active | archived — operational, never the sellable family');
            $table->date('valid_from')->nullable()->comment('inclusive');
            $table->date('valid_to')->nullable()->comment('inclusive — a human writing "valid to 30 June" means through the 30th');

            $table->string('source_system', 40)->nullable();
            $table->string('source_ref', 160)->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('currency_code')->references('code')->on('currencies')->restrictOnDelete();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'status']);
        });

        DB::statement("ALTER TABLE price_lists ADD CONSTRAINT price_lists_customer_scope_check CHECK (customer_scope IN ('public', 'agreement'))");
        DB::statement("ALTER TABLE price_lists ADD CONSTRAINT price_lists_status_check CHECK (status IN ('draft', 'active', 'archived'))");

        // Re-importing the same source tariff must converge rather than
        // duplicate. Partial for the K1.1 reason: applied to the whole tuple
        // it would make every hand-created list — none of which claims a
        // source — collide with the next one.
        DB::statement('CREATE UNIQUE INDEX price_lists_organisation_id_source_unique ON price_lists (organisation_id, source_system, source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('price_lists');
    }
};
