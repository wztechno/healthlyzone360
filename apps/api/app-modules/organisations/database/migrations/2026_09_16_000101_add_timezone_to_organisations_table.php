<?php

declare(strict_types=1);

use Healthy360\Organisations\Services\OrganisationTimezone;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The clock an organisation-wide period is read in (PROD1).
 *
 * Until now the only timezone in the system was `organisation_branches.timezone`,
 * and everything periodic was branch-shaped: a goods receipt's `received_on` is
 * the branch-local business date, the order desk's "today" is the branch's.
 *
 * The weekly ingredient price is not branch-shaped. It is keyed
 * `(organisation, ingredient)` because `ingredient_stock_costs` is, so "which
 * Monday does this week start on" has to have one answer per organisation rather
 * than one per branch — two branches in two timezones would otherwise publish two
 * different weeks for one price and neither would be wrong.
 *
 * **Nullable, and resolved rather than required.** Filling it on every existing
 * organisation would mean picking a branch's timezone on their behalf in a
 * migration, which is exactly the guess {@see OrganisationTimezone}
 * exists to make visible and revisable. Null means "not stated", the resolver
 * answers from the organisation's branches, and an operator who disagrees sets
 * the column. The resolver validates whatever it finds, so a malformed value
 * degrades to the application clock instead of throwing inside a scheduled job.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organisations', function (Blueprint $table): void {
            $table->string('timezone', 64)
                ->nullable()
                ->after('default_language_code')
                ->comment('IANA identifier; null means resolve from the branches');
        });
    }

    public function down(): void
    {
        Schema::table('organisations', function (Blueprint $table): void {
            $table->dropColumn('timezone');
        });
    }
};
