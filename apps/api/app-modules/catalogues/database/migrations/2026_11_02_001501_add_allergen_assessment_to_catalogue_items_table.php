<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Who said a dish contains no allergens, and the one read that lets the rest of
 * the platform ask whether its recipe says otherwise.
 *
 * **The two columns** are the fourth way an item counts as assessed: a member of
 * staff pressed "Assessed: contains none of these". Both are nullable, and null
 * is the default, because silence is not a statement of absence.
 *
 * **The function exists because of row-level security.** "Has a published recipe
 * version with at least one line" has to be answered in SQL for the marketplace
 * and the corporate catalogue, and neither runs under the kitchen's tenant: the
 * marketplace is anonymous and a corporate buyer's context is their own company.
 * The policies on `recipe_versions` and `recipe_version_lines` fail closed there,
 * so a plain `EXISTS` would quietly read false and take every recipe-backed dish
 * off sale for exactly those callers, while the test suite, running as the owner,
 * stayed green. A published-version policy was not the answer either: a formulation
 * is the most sensitive thing this schema holds, and it would expose the whole row.
 *
 * `SECURITY DEFINER` runs it as the migrator, which owns both tables and is not
 * subject to their policies. It answers one boolean and returns no part of the
 * formulation. `search_path` is pinned, as any definer function must, so a caller's
 * path cannot redirect what it reads.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->timestampTz('allergens_assessed_at')->nullable();
            $table->foreignUuid('allergens_assessed_by')->nullable()->constrained('users')->nullOnDelete();
        });

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION recipe_has_published_lines(target_recipe_id uuid, target_organisation_id uuid)
            RETURNS boolean
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
                SELECT EXISTS (
                    SELECT 1
                    FROM recipe_versions
                    JOIN recipe_version_lines ON recipe_version_lines.recipe_version_id = recipe_versions.id
                    WHERE recipe_versions.recipe_id = target_recipe_id
                      AND recipe_versions.organisation_id = target_organisation_id
                      AND recipe_versions.status = 'published'
                )
            $$
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS recipe_has_published_lines(uuid, uuid)');

        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('allergens_assessed_by');
            $table->dropColumn('allergens_assessed_at');
        });
    }
};
