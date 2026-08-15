<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The list of destinations that must never be contacted again — and the one
 * thing a deletion is allowed to leave behind.
 *
 * **The paradox this table resolves.** "Delete everything you hold about me"
 * and "never contact me again" are the same request from the person's side and
 * contradictory from ours: honouring the first perfectly means forgetting that
 * the second was ever asked, and the next import re-adds them. Every serious
 * privacy regime resolves it the same way — a suppression list is a legitimate
 * interest, kept precisely so the erasure is not silently undone.
 *
 * **So the row holds a hash and nothing else.** `contact_hash` is the *same*
 * peppered HMAC that `contact_points.value_hash` carries, produced by the same
 * `ContactValueHasher`, which is what makes this table useful without being a
 * copy of what was deleted: a send path can compare a candidate contact's
 * existing digest column against this one directly, with no plaintext on either
 * side and no second normalisation to get wrong. Somebody holding a dump of this
 * table learns the number of people who asked to be forgotten and nothing about
 * who they are — the pepper lives outside the database.
 *
 * Peppered here where `guest_sessions.token_hash` is not, and for the reason
 * stated there: this input is an email address, drawn from a guessable space, so
 * an unpeppered digest would be a membership oracle. A 384-bit token is not.
 *
 * **`kind` rather than reusing `ContactChannel` verbatim** is a deliberate
 * one-word difference in vocabulary: the values are the same (`email`, `phone`)
 * because they must be for the digests to line up, but this table is not part of
 * the contact-point graph and holds no foreign key into it. It outlives every
 * row it was derived from — that is its job — so a relation would be a
 * dangling one by design.
 *
 * **`source` says why**, and the two values are not interchangeable. `deletion`
 * is a proven erasure request and is permanent. `opt_out` is somebody unchecking
 * a box, which a later opt-in may lift. Collapsing them would mean either
 * honouring an unsubscribe as an erasure or letting a re-subscribe undo one.
 *
 * Isolation strategy: **`platform-only`**. No tenant column and no policy: a
 * suppression is platform-wide by definition — being forgotten by one kitchen
 * and mailed by the next is the failure this table exists to prevent — and it is
 * never read by a client, only consulted by a send path.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('marketing_suppressions', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->string('kind', 10)->comment('email | phone — matches contact_points.channel so the digests line up');
            $table->string('contact_hash', 64)->comment('the same peppered HMAC as contact_points.value_hash; never the value');

            $table->timestamp('suppressed_at');
            $table->string('source', 20)->comment('deletion | opt_out — permanent versus liftable');

            $table->timestamps();

            $table->unique(['kind', 'contact_hash']);
        });

        DB::statement("ALTER TABLE marketing_suppressions ADD CONSTRAINT marketing_suppressions_kind_check CHECK (kind IN ('email', 'phone'))");
        DB::statement("ALTER TABLE marketing_suppressions ADD CONSTRAINT marketing_suppressions_source_check CHECK (source IN ('deletion', 'opt_out'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('marketing_suppressions');
    }
};
