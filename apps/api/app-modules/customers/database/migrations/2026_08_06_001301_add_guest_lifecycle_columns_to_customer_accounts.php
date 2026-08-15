<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The two dates the guest shape needs and the account table did not yet carry.
 *
 * **Additive on purpose.** `customer_accounts` already models the guest shape —
 * `account_type = 'guest'`, `origin = 'guest'`, `user_id IS NULL` enforced by
 * CHECK — and G1 does not revisit any of that. What was missing is a place to
 * write *when the guest identity stops being live* and *when it stopped being a
 * guest*, and both are columns rather than derived values for the same reason
 * `provisional_expires_at` is: a retention window that is recomputed from
 * configuration silently re-dates every row that already exists.
 *
 * **Why not reuse `provisional_expires_at`.** It is the abandonment deadline for
 * a self-service account that somebody started and walked away from, read by
 * `PurgeAbandonedProvisionalAccounts` under a 30-day setting keyed on
 * `verification.provisional_account_ttl_days`. A guest is not abandoned — it was
 * never going to become an account — and its window is 14 days under a different
 * setting for a different reason. Sharing the column would make one job's
 * deadline the other job's, and the day either window moves the wrong rows would
 * be deleted. Conversion (below) is where the two meet: converting stamps
 * `provisional_expires_at` for the first time, because from then on the account
 * *is* a self-service account and the abandonment sweep is the right owner.
 *
 * **Three CHECKs, each closing a way the pair could lie:**
 *
 *  * `guest_expires_at` may only be set while the row is actually a guest. The
 *    conversion path flips `account_type` and nulls the deadline in one UPDATE,
 *    so the constraint is what guarantees a converted account cannot keep a
 *    guest expiry that `ExpireGuestData` would later honour.
 *  * `converted_at` may only be set on a row whose `origin` is `guest` — origin
 *    is immutable history, and conversion deliberately does not rewrite it. A
 *    converted account is a `b2c` account that *came from* a guest, and both
 *    halves of that sentence stay readable.
 *  * A converted account must have a user, which is the same fact the `b2c`
 *    shape CHECK states, asserted again from the conversion side so a
 *    half-applied conversion cannot commit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_accounts', function (Blueprint $table): void {
            $table->timestamp('guest_expires_at')->nullable()->after('provisional_expires_at')
                ->comment('written from guest.windows.account_days at creation; never recomputed for existing rows');
            $table->timestamp('converted_at')->nullable()->after('guest_expires_at')
                ->comment('when this guest became a registered customer; origin stays guest');
        });

        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_guest_expires_at_check CHECK (guest_expires_at IS NULL OR account_type = 'guest')");
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_converted_origin_check CHECK (converted_at IS NULL OR origin = 'guest')");
        DB::statement('ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_converted_user_check CHECK (converted_at IS NULL OR user_id IS NOT NULL)');

        // What the daily sweep scans. Partial, because the overwhelming
        // majority of this table is never a guest and an index that carried
        // them would be mostly nulls.
        DB::statement("CREATE INDEX customer_accounts_guest_expiry_index ON customer_accounts (guest_expires_at) WHERE account_type = 'guest'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS customer_accounts_guest_expiry_index');
        DB::statement('ALTER TABLE customer_accounts DROP CONSTRAINT IF EXISTS customer_accounts_converted_user_check');
        DB::statement('ALTER TABLE customer_accounts DROP CONSTRAINT IF EXISTS customer_accounts_converted_origin_check');
        DB::statement('ALTER TABLE customer_accounts DROP CONSTRAINT IF EXISTS customer_accounts_guest_expires_at_check');

        Schema::table('customer_accounts', function (Blueprint $table): void {
            $table->dropColumn(['guest_expires_at', 'converted_at']);
        });
    }
};
