<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The seam C1 named when it wrote `OrderIdempotency`: a guest has no user, so
 * a table keyed on `user_id` gave guests no replay protection at all — the one
 * population most likely to double-tap a checkout button on a flaky mobile
 * connection.
 *
 * `user_id` becomes nullable and `customer_account_id` joins it, under the same
 * exactly-one-owner rule the rest of the schema uses (§4.9). The unique key is
 * regenerated over the **coalesced subject**, so one key means one thing
 * whichever kind of subject holds it, and a guest's replay is caught by the
 * database rather than by hope.
 *
 * `COALESCE(user_id, customer_account_id)` is safe as a key expression only
 * because the CHECK guarantees exactly one is set: without it, a row with both
 * would silently key on the user and shadow an unrelated account's key.
 *
 * The old three-column unique is dropped rather than kept alongside. Two
 * uniques over overlapping columns would mean two different answers to "has
 * this key been used", and the narrower one would win in a way nobody expects.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('idempotency_keys', function (Blueprint $table): void {
            $table->dropUnique(['key', 'user_id', 'endpoint']);
        });

        DB::statement('ALTER TABLE idempotency_keys ALTER COLUMN user_id DROP NOT NULL');

        Schema::table('idempotency_keys', function (Blueprint $table): void {
            $table->foreignUuid('customer_account_id')->nullable()->after('user_id')
                ->comment('a guest subject; exactly one of this and user_id is set')
                ->constrained('customer_accounts')->cascadeOnDelete();
        });

        DB::statement('ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_subject_check CHECK (num_nonnulls(user_id, customer_account_id) = 1)');

        DB::statement('CREATE UNIQUE INDEX idempotency_keys_subject_unique ON idempotency_keys (key, endpoint, COALESCE(user_id, customer_account_id))');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idempotency_keys_subject_unique');
        DB::statement('ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_subject_check');

        DB::statement('DELETE FROM idempotency_keys WHERE user_id IS NULL');

        Schema::table('idempotency_keys', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('customer_account_id');
        });

        DB::statement('ALTER TABLE idempotency_keys ALTER COLUMN user_id SET NOT NULL');

        Schema::table('idempotency_keys', function (Blueprint $table): void {
            $table->unique(['key', 'user_id', 'endpoint']);
        });
    }
};
