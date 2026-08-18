<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The named people at a supplier (§3.2) — distinct from the supplier's own
 * `contact_email`/`contact_phone`, which stay what INV1.1 made them: the
 * general office line. A kitchen does not phone "Gulf Fresh", it phones Samir
 * who takes the vegetable order, and when Samir leaves the office line is still
 * correct while his number is not. One row per person is what lets the second
 * fact change without disturbing the first.
 *
 * Three channels, all optional individually and **at least one required
 * together** (the CHECK). A contact nobody can reach is not a contact, and
 * phase 2's dispatch work needs a destination that was valid when it was
 * written rather than a name with an empty row behind it. `whatsapp_phone` is
 * its own column rather than a flag on `phone` because in this trade they
 * genuinely differ — the landline takes the call, the mobile takes the order
 * photo.
 *
 * `is_primary` is enforced by a partial unique index, not by application care.
 * "At most one primary" is the kind of invariant two concurrent saves break
 * exactly once and then nobody can explain; the index makes the second write
 * fail rather than the data quietly disagree. `SupplierContactService` validates
 * the same rule first and returns 422, so the 23505 is the backstop rather than
 * the user experience.
 *
 * `display_order` is the kitchen's own ordering — primary first is a convention
 * the UI applies, not a sort the database imposes, because a supplier may
 * legitimately want the person you actually call listed above the person whose
 * name is on the contract.
 *
 * **ADR-0007 isolation: organisation column, application-scoped, no RLS.** The
 * column is carried rather than joined through `suppliers` because these rows
 * are read directly by the contact editor and will be read directly again by
 * phase 2's dispatch destination picker; an explicit `organisation_id` keeps
 * `BelongsToOrganisation` honest on both paths without a join. It does not join
 * the eleven RLS-protected tables and the `RlsTest` pin does not move — a
 * supplier's sales rep is commercial configuration, not the customer,
 * membership and audit data phase 1B chose.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_contacts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('supplier_id')->constrained('suppliers')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('role_title', 120)->nullable();
            $table->string('email', 160)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('whatsapp_phone', 40)->nullable()->comment('kept apart from phone — the landline takes the call, the mobile takes the order');
            $table->boolean('is_primary')->default(false);
            $table->unsignedSmallInteger('display_order')->default(0);
            $table->timestamps();

            $table->index(['supplier_id', 'display_order']);
        });

        // At most one primary per supplier. The service refuses a second one
        // with a 422 first; this is the backstop that stops two concurrent
        // saves from agreeing to disagree.
        DB::statement('CREATE UNIQUE INDEX supplier_contacts_primary_unique ON supplier_contacts (supplier_id) WHERE is_primary');

        // A contact nobody can reach is not a contact.
        DB::statement('ALTER TABLE supplier_contacts ADD CONSTRAINT supplier_contacts_channel_check CHECK (email IS NOT NULL OR phone IS NOT NULL OR whatsapp_phone IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_contacts');
    }
};
