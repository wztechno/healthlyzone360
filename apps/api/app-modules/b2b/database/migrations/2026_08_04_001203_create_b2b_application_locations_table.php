<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Where an applicant company wants deliveries to arrive, and where its
 * invoices should go.
 *
 * **Anchored to the platform gazetteer, not to free text.** `delivery_area_id`
 * points at `delivery_areas` — the same 125-area list a kitchen draws its
 * zones over — so "can we actually deliver here?" is a join rather than a
 * guess at a spelling. It is nullable because an applicant may name a location
 * in a place the gazetteer does not yet cover, and refusing the application on
 * that ground would be the platform's gap becoming the customer's problem; the
 * reviewer sees the unmatched line and either extends the gazetteer or
 * declines with a reason. `restrictOnDelete` from below for the reason K1.7
 * gives: withdrawing a place while somebody's address references it silently
 * unpicks the address, so the platform deactivates areas instead of deleting
 * them.
 *
 * The address columns are deliberately flat and unvalidated beyond "a line and
 * a place". This is transcribed paperwork, not a routable address book — the
 * customer address book (`customer_addresses`, J1) is a different table with a
 * different owner and a different lifecycle, and the integrator wave is what
 * copies an approved location into it. Two representations, one of which is
 * evidence of what was claimed at application time and must therefore never be
 * edited by a later address change.
 *
 * Exactly one location may be `is_primary` per application — the delivery
 * address a first order defaults to — enforced by a partial unique index
 * rather than by a service that remembers.
 *
 * Isolation strategy: **`join-rls-parent`**, same as the contacts table and
 * for the same reason.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('b2b_application_locations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('b2b_application_id')->constrained('b2b_applications')->cascadeOnDelete();

            $table->string('label', 80)->comment('what the company calls it — "Head office", "Hamra branch"');
            // The platform gazetteer. Null = the applicant named a place the
            // gazetteer does not cover yet; see the class comment.
            $table->foreignUuid('delivery_area_id')->nullable()->constrained('delivery_areas')->restrictOnDelete();
            $table->string('address_line1', 200);
            $table->string('address_line2', 200)->nullable();
            $table->string('city', 80)->nullable();
            $table->string('country_code', 2)->nullable();
            $table->string('contact_name', 120)->nullable();
            $table->string('contact_phone', 32)->nullable();
            $table->text('delivery_notes')->nullable()->comment('gate codes, loading bays, the things a driver needs');

            $table->boolean('is_primary')->default(false);
            $table->boolean('is_billing_address')->default(false);
            $table->smallInteger('expected_headcount')->nullable()->comment('how many people eat here — sizes the first order, never a commitment');

            $table->timestamps();

            $table->foreign('country_code')->references('code')->on('countries')->restrictOnDelete();

            $table->index('b2b_application_id');
            $table->index('delivery_area_id');
        });

        DB::statement('ALTER TABLE b2b_application_locations ADD CONSTRAINT b2b_application_locations_headcount_check CHECK (expected_headcount IS NULL OR expected_headcount > 0)');

        // One default delivery address per application.
        DB::statement('CREATE UNIQUE INDEX b2b_application_locations_primary_unique ON b2b_application_locations (b2b_application_id) WHERE is_primary');

        // One place invoices go. Separate index rather than a combined rule,
        // because the billing address is very often not the delivery address
        // and forcing them to be the same row is the mistake this prevents.
        DB::statement('CREATE UNIQUE INDEX b2b_application_locations_billing_unique ON b2b_application_locations (b2b_application_id) WHERE is_billing_address');
    }

    public function down(): void
    {
        Schema::dropIfExists('b2b_application_locations');
    }
};
