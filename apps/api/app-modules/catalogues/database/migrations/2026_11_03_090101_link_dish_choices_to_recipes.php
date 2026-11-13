<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A sauce or side choice links the recipe it is, and takes its allergens from
 * that recipe's published version (owner, 3 Nov 2026).
 *
 * Nullable and not backfilled: nothing here can say which recipe "Garlic sauce"
 * on a dish meant, and a guessed link is a guessed allergen label. A choice with
 * no link is not offered and is refused `option_unlinked` until a kitchen links
 * it. A removal names no recipe, so the check holds that.
 *
 * `nullOnDelete`: a deleted recipe leaves the choice unlinked, which takes it off
 * the menu rather than leaving it pointing at nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('catalogue_item_options', function (Blueprint $table): void {
            $table->foreignUuid('recipe_id')->nullable()->constrained('recipes')->nullOnDelete();
            $table->index('recipe_id');
        });

        DB::statement("ALTER TABLE catalogue_item_options ADD CONSTRAINT catalogue_item_options_recipe_check CHECK (kind = 'choice' OR recipe_id IS NULL)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE catalogue_item_options DROP CONSTRAINT IF EXISTS catalogue_item_options_recipe_check');

        Schema::table('catalogue_item_options', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('recipe_id');
        });
    }
};
