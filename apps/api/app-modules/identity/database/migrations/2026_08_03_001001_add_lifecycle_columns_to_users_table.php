<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An account can now be something other than usable.
 *
 * Until J1 a `users` row had exactly one state — it existed — and the only way
 * to stop somebody signing in was to change their password out from under
 * them. That is not a lifecycle, and J2 (closure) and B2 (offboarding) both
 * need one before they can be written honestly.
 *
 * **Three states, and no soft delete.** `active` is the default and covers
 * every row that exists today. `suspended` is an operator's temporary refusal.
 * `closed` is terminal: the person asked to leave, the record survives because
 * orders and audit events point at it, and the identity stops working. Laravel
 * soft deletes are deliberately absent platform-wide (plan §5) and would be
 * the wrong tool anyway — a closed account is not a deleted row, it is a row
 * that says what happened to it.
 *
 * **`anonymised_at` is separate from `closed_at` on purpose.** Closure is
 * immediate and reversible-by-support; anonymisation is the irreversible sweep
 * J2 performs afterwards, possibly weeks later once a retention period has
 * run. Collapsing them into one timestamp would make "closed but still
 * identifiable" — the normal state during the grace window — unrepresentable.
 *
 * The columns are additive and defaulted, so every existing row is `active`
 * with both timestamps NULL and nothing observable changes. What consults the
 * column is `ActiveUserProvider` (identity): a closed account cannot be
 * retrieved by the guard at all, so neither the Fortify login pipeline nor
 * `POST /api/v1/auth/token` can authenticate one, and an existing session
 * stops resolving to a user on its next request.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('status', 20)->default('active')->after('email_verified_at');
            $table->timestamp('closed_at')->nullable()->after('status');
            $table->timestamp('anonymised_at')->nullable()->after('closed_at');

            $table->index('status');
        });

        DB::statement("ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'closed'))");

        // A closed account has to say when. Without this the state could be
        // set by an UPDATE that leaves no trace of the moment it happened,
        // which is exactly what a closure record must not permit.
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_closed_at_check CHECK (status <> 'closed' OR closed_at IS NOT NULL)");

        // Anonymisation strictly follows closure: there is no path that
        // scrubs an account still in use.
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_anonymised_at_check CHECK (anonymised_at IS NULL OR closed_at IS NOT NULL)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_anonymised_at_check');
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_closed_at_check');
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check');

        Schema::table('users', function (Blueprint $table): void {
            $table->dropIndex(['status']);
            $table->dropColumn(['status', 'closed_at', 'anonymised_at']);
        });
    }
};
