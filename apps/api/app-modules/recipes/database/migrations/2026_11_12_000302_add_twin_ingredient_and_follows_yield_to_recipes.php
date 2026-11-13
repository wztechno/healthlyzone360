<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two facts the server needs to write what a recipe produces by itself (plan slice F).
 *
 * **`recipes.twin_ingredient_id`** — the ingredient a *preparation* is used as inside other
 * recipes. A sauce's twin is its listing's `ingredient_id`; a preparation has no listing, and the
 * link has to exist from the moment the recipe is created, before any yield does. An output row
 * cannot carry it then — `output_quantity > 0` — so the link sits on the recipe, nullable, and is
 * null for everything sold (whose twin the listing holds) and for every recipe created before.
 * `nullOnDelete`: an ingredient is archived, never deleted, but a link must not block one that is.
 *
 * **`recipe_version_outputs.follows_yield`** — whether a row was written by the server from the
 * version's yield. Only such a row is rewritten when the yield changes. A row an importer or a
 * person stated (false, the default — every existing row) is left exactly as it is: a source sheet
 * may legitimately produce a different quantity than its batch weighs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipes', function (Blueprint $table): void {
            $table->foreignUuid('twin_ingredient_id')->nullable()
                ->comment('the ingredient a preparation is used as in other recipes; null when a listing holds the twin')
                ->constrained('ingredients')->nullOnDelete();
        });

        Schema::table('recipe_version_outputs', function (Blueprint $table): void {
            $table->boolean('follows_yield')->default(false)
                ->comment('written by the server from the version yield, and rewritten when it changes');
        });
    }

    public function down(): void
    {
        Schema::table('recipe_version_outputs', function (Blueprint $table): void {
            $table->dropColumn('follows_yield');
        });

        Schema::table('recipes', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('twin_ingredient_id');
        });
    }
};
