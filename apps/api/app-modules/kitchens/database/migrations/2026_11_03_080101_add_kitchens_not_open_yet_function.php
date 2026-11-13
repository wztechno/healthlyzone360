<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The kitchens that have not gone live yet, readable by the anonymous marketplace.
 *
 * `MarketplaceKitchens::visible()` hides them, and has to answer in SQL with no
 * tenant declared. `kitchen_service_settings` is `org-rls` and fails closed there,
 * so a plain `NOT EXISTS` would read nothing and hide nothing in production while
 * the test suite, running as the owner, stayed green. A public read policy would
 * expose every timing and limit on those rows; this returns the identifiers only.
 *
 * `SECURITY DEFINER` with a pinned `search_path`, as `recipe_has_published_lines`.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION kitchens_not_open_yet()
            RETURNS SETOF uuid
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
                SELECT organisation_id FROM kitchen_service_settings WHERE not_open_yet
            $$
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS kitchens_not_open_yet()');
    }
};
