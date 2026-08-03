<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `organisations.status` gains `closed` (master plan v2 Phase B2).
 *
 * The one migration B2 owns outside its own module, and it exists because an
 * offboarded organisation has no honest status in the B1 vocabulary.
 * `suspended` is wrong and dangerously so: a suspended organisation is one the
 * platform stopped from trading and expects to hear from again, its members
 * keep their memberships, and reinstating it is a status change somebody can
 * make in an afternoon. An offboarded one has had every membership ended, its
 * agreement terminated and its personal data purged. Reusing `suspended`
 * would put those two on the same screen under the same word and make
 * "reinstate" look like a supported operation on a company whose data is gone.
 *
 * Deleting the row is not the alternative. The legal entity is **retained** —
 * company registration and tax identifiers survive an offboarding on purpose,
 * because a corporate record has retention obligations the personal data
 * around it does not — and a deleted organisation would take its agreements,
 * its audit trail and its own export record with it.
 *
 * **Drop and recreate, the K1.1 pattern.** PostgreSQL has no "widen this
 * CHECK" statement; the constraint is dropped by its known name and added back
 * with the fourth value. Doing it by name rather than by discovery is what
 * makes the migration reversible: `down()` restores exactly the three-value
 * constraint B1 wrote, and any row already `closed` would — correctly — refuse
 * to let it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE organisations DROP CONSTRAINT organisations_status_check');
        DB::statement("ALTER TABLE organisations ADD CONSTRAINT organisations_status_check CHECK (status IN ('active', 'suspended', 'pending', 'closed'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE organisations DROP CONSTRAINT organisations_status_check');
        DB::statement("ALTER TABLE organisations ADD CONSTRAINT organisations_status_check CHECK (status IN ('active', 'suspended', 'pending'))");
    }
};
