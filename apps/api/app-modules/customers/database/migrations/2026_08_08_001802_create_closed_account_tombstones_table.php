<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What survives a closure: a marker that one did, and nothing that identifies
 * who it was about.
 *
 * **Why anything survives at all.** Finalisation frees the email address —
 * `users.email` becomes `closed+{uuid}@anonymised.invalid` precisely so the
 * person may register again — and deletes every contact point. That is the
 * right answer to "forget me" and it destroys the platform's ability to answer
 * three questions it is still obliged to answer: *did this address ever have an
 * account here*, *was it closed rather than never existing*, and *when*. A
 * support call six weeks later, an abuse report, or a regulator's enquiry all
 * ask one of those, and an erasure that made them unanswerable would have
 * traded one obligation for another.
 *
 * **So the row holds hashes and nothing else** (D-042). `email_hash` is the
 * same peppered HMAC `contact_points.value_hash` uses, so a candidate address
 * can be checked against it without the address ever being stored; the pepper
 * lives in the environment, so a database dump alone proves nothing. There is
 * no plaintext column on this table, no name, no note, and no free text —
 * which is a property worth asserting rather than remembering, and the
 * anonymisation sweep does.
 *
 * **`phone_hashes` is a JSON array rather than a second table.** A person may
 * hold several numbers; none of them is ever looked up individually, only
 * membership-tested; and a child table of hashes would be a join whose only
 * purpose is to make the same answer slower.
 *
 * **`user_id` and `customer_account_id` carry no foreign key, deliberately.**
 * A tombstone must outlive the row it describes. Closure anonymises rather than
 * deletes, so the reference resolves today — but the whole point of a
 * gravestone is that it stands after the thing is gone, and a
 * `cascadeOnDelete` would remove the evidence of a closure at exactly the
 * moment a later hard delete made that evidence matter. They are indexed
 * instead, which is what a lookup actually needs.
 *
 * `reason_code` is kept because it is a fact about a decision, not about a
 * person: "how many people left because we were too expensive" must stay
 * answerable after everybody in the answer has been forgotten.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('closed_account_tombstones', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->uuid('user_id')->comment('no FK: a tombstone must outlive the row it marks');
            $table->uuid('customer_account_id')->nullable()->comment('no FK, same reason');
            $table->foreignUuid('closure_request_id')->nullable()->comment('the request that produced this; nulled rather than cascading if history is ever pruned')->constrained('account_closure_requests')->nullOnDelete();

            $table->timestamp('closed_at');

            $table->char('email_hash', 64)->comment('peppered HMAC-SHA256 of the normalised login address — never the address');
            $table->jsonb('phone_hashes')->default('[]')->comment('peppered digests of every number held; membership-tested, never read back');

            $table->string('reason_code', 40)->comment('a fact about a decision, not about a person');

            $table->timestamps();

            $table->index('email_hash');
            $table->index('closed_at');
            $table->index('customer_account_id');
        });

        DB::statement("ALTER TABLE closed_account_tombstones ADD CONSTRAINT closed_account_tombstones_reason_check CHECK (reason_code IN ('no_longer_needed', 'too_expensive', 'moving_away', 'dietary_needs_unmet', 'service_quality', 'privacy_concerns', 'duplicate_account', 'other'))");

        // One tombstone per closed identity. A second finalisation of the same
        // user is the idempotence case the job is written for, and this is the
        // database saying so rather than trusting it to.
        DB::statement('CREATE UNIQUE INDEX closed_account_tombstones_user_unique ON closed_account_tombstones (user_id)');
    }

    public function down(): void
    {
        Schema::dropIfExists('closed_account_tombstones');
    }
};
