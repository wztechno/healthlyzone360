<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The allergen classes on a recipe's published label, readable without the
 * kitchen's tenant.
 *
 * The marketplace drops a free-from tag its dish's label contradicts, inside the
 * query that reads the tags, so it has to ask the label in SQL. A recipe-backed
 * dish's label is its published version's `recipe_version_allergens`, reachable
 * only through `recipe_versions`, whose policy fails closed for the anonymous
 * marketplace. A plain join there would read "no allergens" and keep the tag:
 * the unsafe way round. So, like `recipe_has_published_lines()` beside it, this
 * runs as the migrator and answers only what the public label already shows.
 *
 * NULL means no published version, so the caller falls back to the item's own
 * ingredients as `DerivedAllergenService::forItem()` does; an empty array means
 * a published label that declares nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION recipe_published_allergen_codes(target_recipe_id uuid, target_organisation_id uuid)
            RETURNS text[]
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
                SELECT COALESCE(
                    array_agg(recipe_version_allergens.allergen_code::text)
                        FILTER (WHERE recipe_version_allergens.allergen_code IS NOT NULL),
                    '{}'::text[]
                )
                FROM recipe_versions
                LEFT JOIN recipe_version_allergens ON recipe_version_allergens.recipe_version_id = recipe_versions.id
                WHERE recipe_versions.recipe_id = target_recipe_id
                  AND recipe_versions.organisation_id = target_organisation_id
                  AND recipe_versions.status = 'published'
                HAVING count(recipe_versions.id) > 0
            $$
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS recipe_published_allergen_codes(uuid, uuid)');
    }
};
