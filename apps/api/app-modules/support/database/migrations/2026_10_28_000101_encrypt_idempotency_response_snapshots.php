<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Replay snapshots become ciphertext.
 *
 * The snapshot is the envelope a client received, and one of those envelopes
 * carries a secret: `POST /organisations/{organisation}/staff` returns the new
 * account's initial password, and the column comment's "redacted" was never
 * true. Anybody who could read the table — a replica, a backup, a support
 * console — could read working credentials for a day.
 *
 * Encrypting the whole snapshot rather than stripping that one key keeps a
 * replay byte-for-byte what the first response was (the contract requires
 * `initial_password`), and covers every other envelope's personal data too.
 *
 * The existing rows are deleted rather than encrypted in place: each expires
 * within a day anyway, and losing one only means a retry in flight during the
 * deploy runs as a fresh request — which the commands' own unique constraints
 * already answer.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('idempotency_keys')->delete();

        DB::statement('ALTER TABLE idempotency_keys ALTER COLUMN response_snapshot TYPE text USING NULL');
        DB::statement("COMMENT ON COLUMN idempotency_keys.response_snapshot IS 'envelope only, encrypted with the application key'");
    }

    public function down(): void
    {
        DB::table('idempotency_keys')->delete();

        DB::statement('ALTER TABLE idempotency_keys ALTER COLUMN response_snapshot TYPE jsonb USING NULL');
        DB::statement("COMMENT ON COLUMN idempotency_keys.response_snapshot IS 'envelope only, redacted'");
    }
};
