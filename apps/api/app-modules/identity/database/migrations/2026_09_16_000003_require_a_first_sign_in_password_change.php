<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A password somebody else chose is a password that has to be replaced.
 *
 * Every account on this platform has, until AA1, been opened by the person who
 * owns it: registration, guest checkout, an invitation accepted from a mailbox
 * only they can read. In all three the password is a secret from the moment it
 * exists.
 *
 * Direct staff provisioning breaks that, and it breaks it deliberately —
 * `POST /api/v1/organisations/{organisation}/staff` exists precisely so a
 * kitchen manager can open an account for somebody standing in front of them
 * who has no mailbox to receive an invitation. The consequence is a working
 * credential that two people know, and the one that is not the account holder
 * is their employer.
 *
 * **This column is how that stops being permanent.** The provisioning endpoint
 * sets it; the change-password route clears it; the landing resolver holds the
 * person on the change-password screen while it is true. What the employer
 * knows is therefore a credential good for exactly one sign-in, which is the
 * least it can be while still being handed over in person.
 *
 * `NOT NULL DEFAULT false`, so every existing row is unaffected and no
 * currently signed-in person is interrupted. Nothing but provisioning ever
 * sets it true.
 *
 * It is **not** part of the `users.status` lifecycle and must not be folded
 * into it. `active | suspended | closed` answers "may this identity be used at
 * all", and `ActiveUserProvider` refuses to retrieve an account that fails it.
 * This answers "may it be used for anything other than choosing a new
 * password", which is a different question asked one layer up: the account is
 * fully active, the session is real, and the only thing being withheld is
 * everywhere else to go.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->boolean('must_change_password')->default(false)->after('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('must_change_password');
        });
    }
};
