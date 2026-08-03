<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The third owner kind, added the way §4.9 said it would be: additively, by
 * widening a named CHECK rather than by rewriting one.
 *
 * A B2B application names a signatory who has, at that moment, no account and
 * no customer record — the applicant is registered, but the person who will
 * sign may not be. The passcode that proves the signatory holds the address
 * still has to go somewhere, and that destination needs the same verification
 * state, the same normalisation and the same duplicate rules as every other
 * contact in the system. Giving applications their own contact table would
 * have produced a second, subtly different implementation of all of it.
 *
 * The two partial uniques that mention an owner column gain a third sibling
 * rather than being generalised: `is_primary` still means "one per owner per
 * channel", and PostgreSQL cannot express that over a coalesce of three
 * columns without losing the FK-shaped clarity the design chose in the first
 * place.
 *
 * The **verified-value** unique index is untouched, and deliberately so. It is
 * global across owner kinds, because "one proven holder of an address" is a
 * statement about the address, not about who claimed it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('contact_points', function (Blueprint $table): void {
            $table->foreignUuid('b2b_application_id')->nullable()->after('customer_account_id')
                ->comment('a signatory or contact named on an application, before any account exists')
                ->constrained('b2b_applications')->cascadeOnDelete();

            $table->index(['b2b_application_id', 'channel']);
        });

        DB::statement('ALTER TABLE contact_points DROP CONSTRAINT contact_points_owner_check');
        DB::statement('ALTER TABLE contact_points ADD CONSTRAINT contact_points_owner_check CHECK (num_nonnulls(user_id, customer_account_id, b2b_application_id) = 1)');

        DB::statement('CREATE UNIQUE INDEX contact_points_application_primary_unique ON contact_points (b2b_application_id, channel) WHERE is_primary AND b2b_application_id IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS contact_points_application_primary_unique');

        DB::statement('ALTER TABLE contact_points DROP CONSTRAINT contact_points_owner_check');
        DB::statement('ALTER TABLE contact_points ADD CONSTRAINT contact_points_owner_check CHECK (num_nonnulls(user_id, customer_account_id) = 1)');

        Schema::table('contact_points', function (Blueprint $table): void {
            $table->dropIndex(['b2b_application_id', 'channel']);
            $table->dropConstrainedForeignId('b2b_application_id');
        });
    }
};
