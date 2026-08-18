<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A supplier stops being a label on a delivery note and becomes a record the
 * kitchen keeps (§3.1). INV1.1 kept the table deliberately tight — "no terms,
 * no addresses" — because a purchases ledger only needed to name who was paid.
 * Ordering needs the rest: you cannot post a supplier an order without an
 * address, and you cannot plan when to order without knowing how long the
 * supplier takes.
 *
 * **`address` and `payment_terms` are free text on purpose.** An address here
 * is what gets written on a printed order sheet and read by a human — a
 * building name, a market stall number, "gate 4, behind the cold store". The
 * structured `customer_addresses` shape exists to be geocoded and delivered to;
 * a supplier's is transcribed from whatever the supplier said. Payment terms
 * likewise: "net 30", "cash on delivery", "50% up front" are the vocabulary of
 * the trade, and an enum over them would refuse the fourth kitchen's terms on
 * the day it was written. Neither field is ever computed against, so neither
 * earns a structure it would have to be forced into.
 *
 * `lead_time_days` is the one number here, so it takes a CHECK: 0–365. Zero is
 * legitimate (a market run the same morning); a year is already absurd for
 * food, and a typed `3650` is the mistake the bound catches.
 *
 * `archived_at` rather than a delete. A supplier that stopped trading still owns
 * every receipt posted against it, and hard-deleting one would either orphan the
 * purchase history or cascade it away — both worse than a supplier that no
 * picker offers. The partial index is what makes the common read cheap: nearly
 * every query wants the live book, so it is the live book that gets the index
 * rather than the whole table.
 *
 * **ADR-0007 isolation: organisation column, application-scoped, no RLS.**
 * `suppliers` already carries `organisation_id` and is read through
 * `BelongsToOrganisation`'s global scope. It does not join the eleven
 * RLS-protected tables and the protected-table pin in `RlsTest` does not move:
 * a supplier name is commercial configuration, not the customer, membership and
 * audit data that phase 1B chose. The review trigger is answered here rather
 * than left implicit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $table): void {
            $table->string('name_ar', 160)->nullable()->after('name_en');
            $table->text('address')->nullable()->after('contact_phone')->comment('free text — transcribed as the supplier gives it, printed on order sheets');
            $table->string('payment_terms', 120)->nullable()->after('address')->comment('free text — "net 30", "cash on delivery"; never computed against');
            $table->unsignedSmallInteger('lead_time_days')->nullable()->after('payment_terms')->comment('working days between issuing an order and expecting it, 0-365');
            $table->text('notes')->nullable()->after('lead_time_days');
            $table->timestamp('archived_at')->nullable()->after('notes')->comment('archived suppliers keep their history but leave every picker');
        });

        // 0 is a same-morning market run; a year is already absurd for food, so
        // the bound catches a typo rather than constraining a real supplier.
        DB::statement('ALTER TABLE suppliers ADD CONSTRAINT suppliers_lead_time_days_check CHECK (lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365))');

        // The live book is the common read — every picker, every list, every
        // suggestion — so it is the live book that is indexed.
        DB::statement('CREATE INDEX suppliers_active_index ON suppliers (organisation_id) WHERE archived_at IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS suppliers_active_index');
        DB::statement('ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_lead_time_days_check');

        Schema::table('suppliers', function (Blueprint $table): void {
            $table->dropColumn(['name_ar', 'address', 'payment_terms', 'lead_time_days', 'notes', 'archived_at']);
        });
    }
};
