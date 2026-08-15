<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A named contact can now be *unreachable on purpose* (master plan v2 Phase B2).
 *
 * B1 wrote that "a contact nobody can reach is not a contact" and gave the
 * table a CHECK requiring an email or a phone. That is right while the
 * relationship is live, and it is exactly wrong at the end of one: offboarding
 * purges the personal data of the people a company named, and the B1
 * constraint made the purge impossible — the row could only be emptied by
 * being deleted.
 *
 * Deleting it is the wrong answer. The application's own history says three
 * people were named and invited; a row that vanished would leave that history
 * pointing at nothing, and would erase the fact that a purge ever happened.
 * What has to survive is the *role* and the fact of the purge; what has to go
 * is everything that identifies a person.
 *
 * So the constraint is widened by one disjunct rather than dropped. A contact
 * still has to be reachable **unless it has been purged**, and `purged_at` is
 * what says so — a timestamp rather than a flag, because "when were this
 * person's details removed" is the question a data-protection enquiry asks.
 * It is also what makes the purge idempotent: a re-run of an archive step
 * skips the rows already stamped, without having to recognise a marker string.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('b2b_application_contacts', function (Blueprint $table): void {
            $table->timestamp('purged_at')->nullable()->after('notes')
                ->comment('personal data removed at offboarding; the role and the fact of the purge are retained');
        });

        DB::statement('ALTER TABLE b2b_application_contacts DROP CONSTRAINT b2b_application_contacts_reachable_check');
        DB::statement('ALTER TABLE b2b_application_contacts ADD CONSTRAINT b2b_application_contacts_reachable_check CHECK (purged_at IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)');

        // A purged contact must actually be purged. Without this, the widened
        // constraint would let a live row set `purged_at` and keep its email,
        // which is the opposite of what the column is for.
        DB::statement('ALTER TABLE b2b_application_contacts ADD CONSTRAINT b2b_application_contacts_purged_check CHECK (purged_at IS NULL OR (email IS NULL AND phone IS NULL))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE b2b_application_contacts DROP CONSTRAINT IF EXISTS b2b_application_contacts_purged_check');
        DB::statement('ALTER TABLE b2b_application_contacts DROP CONSTRAINT b2b_application_contacts_reachable_check');
        DB::statement('ALTER TABLE b2b_application_contacts ADD CONSTRAINT b2b_application_contacts_reachable_check CHECK (email IS NOT NULL OR phone IS NOT NULL)');

        Schema::table('b2b_application_contacts', function (Blueprint $table): void {
            $table->dropColumn('purged_at');
        });
    }
};
