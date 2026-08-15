<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The people an applicant company names — who to call about an order, who to
 * send an invoice to, who signs.
 *
 * **This is not `contact_points`, and the difference is the point.** A contact
 * point (Identity, J1) is a *destination the platform has or has not proven*:
 * it carries a normalised value, an HMAC hash, a verification timestamp and a
 * uniqueness rule designed around who has proven what. An application contact
 * is a *claim a company makes about its own staff* — "our accounts payable is
 * Rana, here is her desk number". Nobody verifies it, nothing is sent to it
 * before provisioning, and two applicants may perfectly well name the same
 * shared mailbox. Modelling it as a contact point would import a verification
 * apparatus that has nothing to verify and a uniqueness rule that would reject
 * legitimate data.
 *
 * Provisioning is where the two meet: the integrator wave turns the accepted
 * contacts into real contact points and invitations against the organisation
 * approval creates. Until then this table is exactly what it looks like —
 * transcribed paperwork.
 *
 * `role` is unique per application because "the billing contact" is a slot
 * rather than a list. A company with two people in accounts payable names one
 * of them here and sorts the rest out in its own inbox; a form that accepted
 * both would have to answer "which one do we invoice?" and would answer it
 * arbitrarily.
 *
 * Isolation strategy: **`join-rls-parent`** in vocabulary — a contact is
 * reachable only through its application, cascades with it, and has no
 * independent read path. In B1 that parent is itself application-scoped (see
 * `b2b_applications`), so this table has no policy either, by the same stated
 * decision.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('b2b_application_contacts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('b2b_application_id')->constrained('b2b_applications')->cascadeOnDelete();

            $table->string('role', 20)->comment('primary | billing | operations | signatory — a slot, not a list');
            $table->string('name', 120);
            $table->string('title', 120)->nullable();
            $table->string('email', 160)->nullable();
            $table->string('phone', 32)->nullable();
            $table->text('notes')->nullable();

            $table->timestamps();

            $table->unique(['b2b_application_id', 'role']);
        });

        DB::statement("ALTER TABLE b2b_application_contacts ADD CONSTRAINT b2b_application_contacts_role_check CHECK (role IN ('primary', 'billing', 'operations', 'signatory'))");

        // A contact nobody can reach is not a contact. One of the two channels
        // has to be there, and which one is the company's choice.
        DB::statement('ALTER TABLE b2b_application_contacts ADD CONSTRAINT b2b_application_contacts_reachable_check CHECK (email IS NOT NULL OR phone IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('b2b_application_contacts');
    }
};
