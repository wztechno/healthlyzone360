<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The domain a kitchen's staff sign in under.
 *
 * ## The problem this solves, and the one it deliberately does not
 *
 * A kitchen hand does not have a work email address. The person washing
 * vegetables at six in the morning has a phone and a first name, and asking
 * them to remember `ahmad.khalil@verdant-kitchen.example` before they can
 * clock in is asking them not to use the system.
 *
 * The obvious fix — a `username` column and a login that accepts either — is
 * the wrong one, and it is worth saying why rather than leaving it as a road
 * not taken. Fortify authenticates on `users.email`; so does
 * `AttemptToAuthenticate`, so does `POST /api/v1/auth/token`, so does password
 * reset, so does the invitation's own address match. A second identifier means
 * every one of those grows a branch, and an identity system with two ways to
 * name the same person has two ways to get it wrong.
 *
 * **So the address stays an address, and the client stops making the person
 * type all of it.** This column holds the right-hand side — `verdant.h360.app`
 * — and the sign-in screen renders a local-part field beside a picker that
 * supplies it. The composed `ahmad.khalil@verdant.h360.app` is an ordinary
 * email address that Fortify, Sanctum, the token endpoint and the reset flow
 * all handle exactly as they do today. Nothing in the authentication pipeline
 * knows this column exists.
 *
 * ## Unique, and nullable
 *
 * Unique because the domain *is* the disambiguator: two kitchens sharing one
 * would make `ahmad@shared` ambiguous in the only field that is supposed to
 * resolve it, and the collision would surface as somebody signing into the
 * wrong kitchen rather than as an error.
 *
 * Nullable because most organisations have no business having one. A corporate
 * customer's buyers use their own company addresses; a consumer has no
 * organisation at all. A kitchen that sets one is opting into staff sign-in,
 * and `GET /api/v1/auth/staff-domains` lists exactly those that have.
 *
 * ## It is not a secret, and the endpoint that serves it says so
 *
 * A staff domain appears in every staff address, and the organisation's name
 * is already public on the marketplace. Listing the pair anonymously discloses
 * nothing that was not already disclosed — which is worth stating here,
 * because the invitation endpoints next door go to deliberate lengths *not* to
 * confirm that a given tenant exists, and the difference between the two
 * postures should look considered rather than inconsistent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organisations', function (Blueprint $table): void {
            $table->string('staff_email_domain')->nullable()->unique()->after('slug');
        });

        // Lower-case, no scheme, no path, no `@`: what goes after the `@` and
        // nothing else. Enforced here rather than only in a form request,
        // because a seeder and a console both write this column and an address
        // composed from a malformed domain fails at sign-in — the furthest
        // possible point from where the mistake was made.
        DB::statement(
            "ALTER TABLE organisations ADD CONSTRAINT organisations_staff_email_domain_check
             CHECK (staff_email_domain IS NULL OR staff_email_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')"
        );
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_staff_email_domain_check');

        Schema::table('organisations', function (Blueprint $table): void {
            $table->dropUnique(['staff_email_domain']);
            $table->dropColumn('staff_email_domain');
        });
    }
};
