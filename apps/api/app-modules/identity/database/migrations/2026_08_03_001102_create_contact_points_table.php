<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Where a person can be reached, and whether that has been proven.
 *
 * **This table does not compete with `users.email`** (master plan v2 §4.10,
 * reviewer point 9). `users.email` stays the authentication identity: Fortify
 * looks up an account by it, the password broker mails it, and nothing here
 * changes that. A contact point is a *destination* — the address an OTP goes
 * to, the number a courier calls — plus the verification state of that
 * destination. The login address exists in both places, and the rule that
 * keeps them from disagreeing is a single write path: `CreateNewUser` writes
 * the login row inside the registration transaction, and the `Verified`
 * listener stamps `verified_at` when the email is confirmed. Login *via* phone
 * would be an identity migration and is explicitly out of scope.
 *
 * **Explicit FK ownership, not a polymorphic pair** (§4.9, reviewer point 10).
 * `user_id` and `customer_account_id` are real foreign keys and exactly one is
 * set — enforced by `num_nonnulls(...) = 1`, not by a service that remembers.
 * A guest has no user, so its contacts hang off the account; a registered
 * person's contacts hang off the identity and survive every account they hold.
 * B1 widens the CHECK additively for `b2b_application_id`, which is why the
 * constraint is named rather than inlined.
 *
 * **Two representations of the value, and neither is the raw one twice.**
 * `value_normalised` is what we send to — lowercased for email, E.164 for
 * phone — and it is the only form anything downstream uses, so "Ali@X.com"
 * and "ali@x.com" cannot become two contacts. `value_hash` is an HMAC under a
 * pepper held outside the database, and it exists for one job: deciding
 * whether a *verified* contact already exists without scanning plaintext. The
 * hash is what the unique index is built on, so duplicate detection never
 * needs the plaintext in an index a query plan might spill.
 *
 * The uniqueness rule is deliberately narrow — **verified, unretired, per
 * channel**. Two people may both *claim* an address (a typo, a shared family
 * mailbox, an attacker); only one may ever have *proven* it. Enforcing
 * uniqueness on unverified rows would let anybody deny an address to its real
 * owner by typing it first, which is the enumeration attack this design most
 * needs to avoid. `retired_at` releases the value again under the tombstone
 * policy (D-042) without deleting the history of who once held it.
 *
 * Isolation strategy: **`user-owner-rls` / `customer-owner-rls`** in
 * vocabulary, application-scoped in J1. No PostgreSQL policy joins the set
 * here: the customer-owned rows are reachable only through
 * `customer_accounts`, which does carry a policy, and the user-owned rows are
 * reached exclusively through the authenticated person's own identity. The
 * decision is recorded rather than assumed — `RlsTest` pins the protected set
 * at eleven tables, so this table's absence from it is a stated choice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contact_points', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->constrained('customer_accounts')->cascadeOnDelete();

            $table->string('channel', 10)->comment('email | phone — the kind of destination, not the transport');
            $table->string('value_normalised')->comment('lowercased email or E.164 phone; the only form anything sends to');
            $table->string('value_hash', 64)->comment('HMAC-SHA256 under the contact pepper; what duplicate detection compares');
            $table->string('label', 40)->nullable();

            $table->boolean('is_login_identity')->default(false)
                ->comment('mirrors users.email; exactly one per user, written only by the registration path');
            $table->boolean('is_primary')->default(false);

            $table->timestamp('verified_at')->nullable();
            $table->timestamp('retired_at')->nullable()->comment('tombstone (D-042): releases the value for reuse without erasing who held it');
            $table->string('source', 20)->default('self_service')->comment('self_service | registration | staff | import');

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['user_id', 'channel']);
            $table->index(['customer_account_id', 'channel']);
            $table->index('value_hash');
        });

        DB::statement("ALTER TABLE contact_points ADD CONSTRAINT contact_points_channel_check CHECK (channel IN ('email', 'phone'))");
        DB::statement("ALTER TABLE contact_points ADD CONSTRAINT contact_points_source_check CHECK (source IN ('self_service', 'registration', 'staff', 'import'))");

        // Exactly one owner. Named so B1 can widen it additively rather than
        // rewrite it.
        DB::statement('ALTER TABLE contact_points ADD CONSTRAINT contact_points_owner_check CHECK (num_nonnulls(user_id, customer_account_id) = 1)');

        // The login mirror is an identity fact, so it can only ever sit on a
        // user-owned row.
        DB::statement('ALTER TABLE contact_points ADD CONSTRAINT contact_points_login_identity_check CHECK (NOT is_login_identity OR (user_id IS NOT NULL AND channel = \'email\'))');

        // One proven holder of a value per channel. Partial on purpose — see
        // the class comment: unverified claims must be allowed to collide, or
        // typing somebody else's address first would lock them out of it.
        DB::statement('CREATE UNIQUE INDEX contact_points_verified_value_unique ON contact_points (channel, value_hash) WHERE verified_at IS NOT NULL AND retired_at IS NULL');

        // One login mirror per person, so the drift test has exactly one row
        // to compare `users.email` against.
        DB::statement('CREATE UNIQUE INDEX contact_points_login_identity_unique ON contact_points (user_id) WHERE is_login_identity');

        // One primary destination per owner per channel.
        DB::statement('CREATE UNIQUE INDEX contact_points_user_primary_unique ON contact_points (user_id, channel) WHERE is_primary AND user_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX contact_points_account_primary_unique ON contact_points (customer_account_id, channel) WHERE is_primary AND customer_account_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('contact_points');
    }
};
