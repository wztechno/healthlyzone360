<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A guest's bearer credential, and how much it is allowed to do.
 *
 * **Not a Sanctum token, and the reason is structural rather than stylistic**
 * (D-039). Sanctum models a personal access token belonging to an authenticated
 * `users` row; a guest has no user, and that is the entire definition of a
 * guest. Issuing a Sanctum token would mean creating the identity the guest
 * shape exists to avoid, and then explaining forever why half the `users` table
 * are people who never registered. What is wanted is smaller: an opaque bearer
 * secret, an expiry, and a capability grade.
 *
 * **`token_hash` is a plain SHA-256, deliberately, where
 * `contact_points.value_hash` is a peppered HMAC.** The difference is the input
 * space. An email address is drawn from a guessable set, so an unpeppered digest
 * column would let anybody holding a dump confirm membership — hence the pepper
 * there. A token here is 48 bytes from the CSPRNG: 384 bits, no dictionary, no
 * structure, nothing to confirm. Adding a pepper would imply the digest needs
 * protecting from an attack that cannot be mounted, and would tie token
 * validation to a secret whose rotation would log every guest out mid-checkout.
 * The plaintext is returned exactly once, at `start()`, and stored nowhere.
 *
 * **`grade` is the capability, and it is the whole authorisation model here.**
 * `checkout_draft` is what an anonymous browser gets: build a basket, price it,
 * pick a slot. `place_order` is what it becomes once a contact point has been
 * proven with a passcode, because an order that cannot be confirmed to anybody
 * is an order nobody can be told is late. The CHECK below makes the upgrade
 * structural rather than procedural: `place_order` without
 * `contact_verified_at` is not a row the database will accept, so a bug that
 * forgot to verify cannot mint an ordering token.
 *
 * **`ip_hash` and `user_agent_hash`, never the values.** They exist for one
 * question — is one origin minting a thousand guest sessions — and answering it
 * needs equality, not the address. Storing the address would put a personal
 * identifier on every anonymous session, which is the opposite of what an
 * anonymous session is for.
 *
 * **`revoked_at` rather than a delete.** Conversion revokes every session the
 * guest held, and so does a deletion request; a tombstone lets `resolve()` tell
 * "this was withdrawn" from "this lapsed" for the day the row survives
 * (`guest.retention.session_rows_hours`), which is what an abuse report needs to
 * read. `PurgeExpiredGuestSessions` removes it after that.
 *
 * `updated_at` is carried even though the row is nearly immutable: `last_used_at`
 * moves on every request, and a table where one timestamp advances while the
 * framework's own does not is a table that quietly disagrees with every other
 * one in the schema.
 *
 * Isolation strategy: **`platform-only` service access + FK ownership**, the same
 * decision `otp_challenges` records. No PostgreSQL policy and no tenant column: a
 * session is never listed and never browsed, only resolved by digest through
 * `GuestSessionService`. An organisation predicate would imply a tenant-scoped
 * read path over other people's credentials, which must not exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guest_sessions', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('customer_account_id')->comment('the guest account this token speaks for')->constrained('customer_accounts')->cascadeOnDelete();

            $table->string('token_hash', 64)->unique()->comment('SHA-256 of the opaque token; the plaintext is returned once and stored nowhere');

            $table->string('grade', 20)->default('checkout_draft')->comment('checkout_draft | place_order — what this token may do');
            $table->timestamp('contact_verified_at')->nullable()->comment('when a passcode proved a contact for this session; what promotes the grade');

            $table->timestamp('expires_at');
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('revoked_at')->nullable()->comment('withdrawn rather than lapsed; kept briefly so the two stay distinguishable');

            $table->string('ip_hash', 64)->nullable()->comment('hashed, never the address');
            $table->string('user_agent_hash', 64)->nullable()->comment('hashed, never the header');

            $table->timestamps();

            $table->index(['customer_account_id', 'revoked_at']);
            $table->index('expires_at');
        });

        DB::statement("ALTER TABLE guest_sessions ADD CONSTRAINT guest_sessions_grade_check CHECK (grade IN ('checkout_draft', 'place_order'))");

        // The upgrade is a database fact, not a service's good intentions.
        DB::statement("ALTER TABLE guest_sessions ADD CONSTRAINT guest_sessions_grade_proof_check CHECK (grade <> 'place_order' OR contact_verified_at IS NOT NULL)");
    }

    public function down(): void
    {
        Schema::dropIfExists('guest_sessions');
    }
};
