<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Narrows `recipe_published_allergen_codes()` to a yes-or-no question.
 *
 * The earlier function handed back a recipe's whole published label for any
 * recipe and organisation, including sub-recipes and recipes no listing sells.
 * The marketplace only needs to know whether the label carries one of a few
 * classes, so that is all this answers. Like `recipe_has_published_lines()`, it
 * runs as the migrator because the anonymous marketplace cannot see
 * `recipe_versions`, and its `search_path` is pinned.
 *
 * NULL means there is no published version, so the caller falls back to the
 * item's own ingredients as `DerivedAllergenService::forItem()` does. False
 * means a published label that carries none of `target_codes`.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION recipe_published_label_has(target_recipe_id uuid, target_organisation_id uuid, target_codes text[])
            RETURNS boolean
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public, pg_temp
            AS $$
                SELECT COALESCE(bool_or(recipe_version_allergens.allergen_code::text = ANY (target_codes)), false)
                FROM recipe_versions
                LEFT JOIN recipe_version_allergens ON recipe_version_allergens.recipe_version_id = recipe_versions.id
                WHERE recipe_versions.recipe_id = target_recipe_id
                  AND recipe_versions.organisation_id = target_organisation_id
                  AND recipe_versions.status = 'published'
                HAVING count(recipe_versions.id) > 0
            $$
            SQL);

        DB::statement('DROP FUNCTION IF EXISTS recipe_published_allergen_codes(uuid, uuid)');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS recipe_published_label_has(uuid, uuid, text[])');
    }
};
