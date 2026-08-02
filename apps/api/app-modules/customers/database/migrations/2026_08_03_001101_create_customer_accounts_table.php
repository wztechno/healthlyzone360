<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A customer account — the commercial identity that orders food.
 *
 * **A customer is not a user** (roadmap §4 checklist). A `users` row is one
 * person's login; a customer account is the party a kitchen sells to. The two
 * separate immediately: a guest orders with no login at all, a company's
 * account outlives the individual who opened it, and one person may hold a
 * consumer account and be a buyer on a corporate one. Folding the customer
 * into the user would make every one of those a special case on the identity
 * table.
 *
 * **Three shapes, one table, enforced by CHECK** (§4.9). `b2c` is a person's
 * own account and must have a user. `guest` must not have one — that is what
 * makes it a guest — and carries its contact details on `contact_points`
 * instead. `b2b` must have an organisation, because the buyer is the company.
 * The shapes share a table because they share everything that matters
 * downstream (addresses, orders, consents), and a discriminator with three
 * CHECKs is honest about that where three tables with duplicated children
 * would not be. G1 converts a guest to `b2c` by attaching a user, which is a
 * shape change the CHECKs already permit.
 *
 * **`organisation_id` is nullable and that is the D2C case.** A consumer
 * account belongs to the platform, not to a kitchen: the same person orders
 * from two kitchens without holding two accounts. B1 fills the column for the
 * corporate shape.
 *
 * **The lifecycle columns (appendix D-bis #5).** `provisional` is where every
 * self-service account starts — an email exists, nothing has been verified,
 * and no order can be placed. `active` is the evaluator's verdict made
 * durable, never a client-supplied status. `suspended` and `closed` are J2's,
 * declared here so the state machine is complete rather than growing a state
 * per phase. Each transition has its own timestamp because "when did this
 * account activate" is a question orders, subscriptions and retention all ask,
 * and `updated_at` cannot answer it.
 *
 * `provisional_expires_at` is what PurgeAbandonedProvisionalAccounts reads. It
 * is written from configuration (`verification.provisional_account_ttl_days`,
 * 30 days pending OQ-029) and is deliberately a stored column rather than a
 * computed window: the retention period will change, and accounts created
 * under the old one must not silently acquire the new deadline.
 *
 * `account_number` is the human-quotable identity — the thing a person reads
 * down a phone line — and is unique platform-wide rather than per
 * organisation, because support handles calls before it knows the tenant.
 *
 * Isolation strategy: **`org-rls` + user-owner**. The policy lands in
 * 2026_08_03_001107 and is the eleventh table in the protected set: a person
 * reaches their own account through `app.user_id` with no organisation
 * resolved at all (a consumer has none), and a corporate account is reachable
 * inside its organisation. Both predicates are needed; either alone would shut
 * out one of the two shapes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_accounts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('account_number', 24)->unique()->comment('human-quotable; unique platform-wide because support answers before it knows the tenant');
            $table->string('account_type', 10)->comment('b2c | b2b | guest — the shape CHECKs below depend on it');

            $table->foreignUuid('user_id')->nullable()->comment('the account holder; NULL for guest, required for b2c')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->nullable()->comment('NULL = platform-direct consumer; required for b2b')->constrained('organisations')->cascadeOnDelete();

            $table->string('status', 20)->default('provisional')->comment('provisional | active | suspended | closed');
            $table->string('origin', 24)->default('self_service')->comment('self_service | guest | b2b_provisioning | staff | import');

            $table->string('display_name')->nullable()->comment('what the kitchen sees; a company name or the person own');
            $table->string('preferred_language_code', 2)->nullable();
            $table->string('country_code', 2)->nullable();

            $table->timestamp('activated_at')->nullable();
            $table->timestamp('suspended_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('anonymised_at')->nullable();
            $table->timestamp('last_activity_at')->nullable();
            $table->timestamp('provisional_expires_at')->nullable()->comment('written from configuration at creation; never recomputed for existing rows');

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('lock_version')->default(0);
            $table->timestamps();

            $table->foreign('preferred_language_code')->references('code')->on('languages')->restrictOnDelete();
            $table->foreign('country_code')->references('code')->on('countries')->restrictOnDelete();

            $table->index(['status', 'provisional_expires_at']);
            $table->index(['organisation_id', 'status']);
            $table->index(['user_id', 'status']);
        });

        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_account_type_check CHECK (account_type IN ('b2c', 'b2b', 'guest'))");
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_status_check CHECK (status IN ('provisional', 'active', 'suspended', 'closed'))");
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_origin_check CHECK (origin IN ('self_service', 'guest', 'b2b_provisioning', 'staff', 'import'))");

        // The three shapes. Written as implications rather than one composite
        // expression so a violation names the shape that was breached.
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_b2c_shape_check CHECK (account_type <> 'b2c' OR user_id IS NOT NULL)");
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_guest_shape_check CHECK (account_type <> 'guest' OR user_id IS NULL)");
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_b2b_shape_check CHECK (account_type <> 'b2b' OR organisation_id IS NOT NULL)");

        // A state that cannot say when it was entered is a state somebody can
        // set silently.
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_activated_at_check CHECK (status <> 'active' OR activated_at IS NOT NULL)");
        DB::statement("ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_closed_at_check CHECK (status <> 'closed' OR closed_at IS NOT NULL)");
        DB::statement('ALTER TABLE customer_accounts ADD CONSTRAINT customer_accounts_anonymised_at_check CHECK (anonymised_at IS NULL OR closed_at IS NOT NULL)');

        // One consumer account per person. Partial, because the same person
        // may hold any number of b2b accounts (they buy for two companies) and
        // guest rows carry no user at all.
        DB::statement("CREATE UNIQUE INDEX customer_accounts_b2c_user_unique ON customer_accounts (user_id) WHERE account_type = 'b2c'");
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_accounts');
    }
};
