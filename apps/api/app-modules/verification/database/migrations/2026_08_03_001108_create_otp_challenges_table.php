<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A one-time passcode in flight.
 *
 * **The code is never here.** `code_hash` is HMAC-SHA256 of the six digits
 * under a pepper held outside the database (`verification.otp.pepper`).
 * Six digits is a keyspace of one million, so a plain SHA-256 of the code
 * would be reversible by a laptop in under a second — the pepper is what makes
 * the stored value useless to somebody holding a dump, and it is the reason
 * this is an HMAC rather than a hash. The plaintext exists in exactly two
 * places: the message that was sent, and the encrypted queue payload that sent
 * it.
 *
 * **`purpose` is declared complete, not grown per phase.** `closure_step_up`,
 * `payment_details_step_up` and `b2b_signatory` have no caller in J1 and are
 * in the CHECK anyway, because widening a CHECK constraint in J2 and B1 would
 * be a migration on a table those phases are otherwise only reading. The
 * vocabulary is the journeys' own (appendix A); a value nobody issues yet is a
 * reserved word, not a lie.
 *
 * **One live challenge per contact per purpose**, enforced by a partial unique
 * index rather than by the service checking first. Two live challenges for the
 * same address is the bug that makes an attempt counter meaningless: a caller
 * exhausting three attempts simply reads the other row's code. Issuing a new
 * challenge therefore supersedes the old one inside the same transaction —
 * the index is what guarantees there is no window in which both are live.
 *
 * **Attempts are incremented before the comparison** (see `OtpService::verify`)
 * under `SELECT … FOR UPDATE`. The obvious order — compare, then count the
 * failure — lets two concurrent requests both read `attempts = 2` and both get
 * a third guess; worse, a crash between the comparison and the increment is a
 * free attempt. Counting first makes the row the lock and the ledger at once.
 *
 * **Ownership is explicit** (§4.9): `user_id` and `customer_account_id`, exactly
 * one, by CHECK. B1 widens the constraint additively for
 * `b2b_application_id`. `contact_point_id` is separate and always present — it
 * says which destination is being proven, which is not the same question as
 * who the challenge belongs to (a guest's contact belongs to their account, a
 * member's to their identity).
 *
 * Isolation strategy: **`platform-only` service access + FK ownership**. No
 * PostgreSQL policy and no tenant column: a challenge is never listed, never
 * browsed, and never reached except by identifier through `OtpService`. Adding
 * an organisation predicate would imply a tenant-scoped read path that must
 * not exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('otp_challenges', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('contact_point_id')->comment('the destination being proven')->constrained('contact_points')->cascadeOnDelete();

            $table->foreignUuid('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->constrained('customer_accounts')->cascadeOnDelete();

            $table->string('purpose', 30)->comment('the journey this challenge belongs to; three values are reserved for J2/B1');
            $table->string('channel', 10)->comment('email | sms | whatsapp — how the code was sent');
            $table->string('destination_masked', 64)->comment('server-authored; the client never masks a value it was not given');

            $table->string('code_hash', 64)->comment('HMAC-SHA256 under the OTP pepper — never the code');

            $table->string('status', 20)->default('pending')->comment('pending | verified | expired | failed | superseded');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedSmallInteger('max_attempts');
            $table->unsignedSmallInteger('resend_count')->default(0);
            $table->unsignedSmallInteger('max_resends');

            $table->timestamp('expires_at');
            $table->timestamp('last_sent_at')->nullable();
            $table->timestamp('resend_available_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('finished_at')->nullable()->comment('when the challenge stopped being live; what the purge job reads');

            $table->string('request_ip_hash', 64)->nullable()->comment('hashed, never the address itself');
            $table->timestamps();

            $table->index(['status', 'expires_at']);
            $table->index(['contact_point_id', 'purpose']);
            $table->index('finished_at');
        });

        DB::statement("ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('contact_verification', 'guest_order', 'guest_deletion', 'closure_step_up', 'payment_details_step_up', 'b2b_signatory'))");
        DB::statement("ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_channel_check CHECK (channel IN ('email', 'sms', 'whatsapp'))");
        DB::statement("ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_status_check CHECK (status IN ('pending', 'verified', 'expired', 'failed', 'superseded'))");

        // Exactly one owner. Named so B1 can widen it additively.
        DB::statement('ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_owner_check CHECK (num_nonnulls(user_id, customer_account_id) = 1)');

        DB::statement('ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_attempts_check CHECK (attempts <= max_attempts)');
        DB::statement('ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_resends_check CHECK (resend_count <= max_resends)');

        // A verified challenge has to say when, and a finished one has to be
        // finished: `pending` is the only status a live row may hold.
        DB::statement("ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_verified_at_check CHECK (status <> 'verified' OR verified_at IS NOT NULL)");
        DB::statement("ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_finished_at_check CHECK ((status = 'pending') = (finished_at IS NULL))");

        // One live challenge per destination per purpose. The service
        // supersedes inside a transaction; this index is what closes the
        // window in which both could be live.
        DB::statement("CREATE UNIQUE INDEX otp_challenges_live_unique ON otp_challenges (contact_point_id, purpose) WHERE status = 'pending'");
    }

    public function down(): void
    {
        Schema::dropIfExists('otp_challenges');
    }
};
