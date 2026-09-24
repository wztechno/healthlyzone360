<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An index behind "what sells this recipe".
 *
 * `catalogue_items.recipe_id` has been a constrained foreign key since the table
 * was created, and **PostgreSQL does not index a foreign key** — so every read
 * that arrives at the catalogue knowing a recipe has been a scan of the
 * organisation's items. Until now that was one row at a time (the archive and
 * retire guards, the quarantine). The recipe book asks it for a whole page:
 * which items sell these twenty-five recipes, whether any of them is a sauce,
 * whether any of them is published, and whether any of them matches a search.
 *
 * `organisation_id` leads because every one of those reads correlates it
 * explicitly — `catalogue_items` is scoped in the application, not by a policy,
 * so the tenant guard is a predicate the query states and the index can serve.
 *
 * **Plain, not unique.** One recipe may back more than one article: a kitchen
 * that sells a half portion beside a whole one has one formulation and two
 * items, which is what `portion_factor` exists to express
 * (`2026_09_13_000003_add_portion_factor_to_catalogue_items_table`). Live data
 * happens to be one to one; a unique index would turn that accident into a rule
 * the schema already documents as false.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->index(['organisation_id', 'recipe_id']);
        });
    }

    public function down(): void
    {
        Schema::table('catalogue_items', function (Blueprint $table): void {
            $table->dropIndex(['organisation_id', 'recipe_id']);
        });
    }
};
