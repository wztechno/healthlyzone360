<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The platform category a preparation's ingredient twin is filed under (plan slice F).
 *
 * A preparation — a recipe nothing sells: a base, a marinade, a sauce made only to go into meals —
 * is used inside other recipes through an ingredient of its own, the way a sauce is used through
 * the twin its listing writes. That twin needs a shelf in the taxonomy that says what it is, so a
 * cook reading the line picker can tell "made here" from "bought in".
 *
 * Data, not a seeder row: deploys never run seeders, and a server-created twin looking for this
 * code on a database that never received it would be filed nowhere. The seeder skips a code that
 * already exists, so the two never collide.
 *
 * **Idempotent** — a code already present is left alone. **`down()` removes only an unused row**:
 * a twin filed here keeps its category rather than a rollback stripping it, and on the empty
 * database CI rolls back there is nothing referencing it, so the row goes.
 */
return new class extends Migration
{
    private const string CODE = 'preparation';

    public function up(): void
    {
        $exists = DB::table('ingredient_categories')
            ->whereNull('organisation_id')
            ->where('code', self::CODE)
            ->exists();

        if ($exists) {
            return;
        }

        DB::table('ingredient_categories')->insert([
            'id' => (string) Str::orderedUuid(),
            'organisation_id' => null,
            'parent_id' => null,
            'code' => self::CODE,
            'name_en' => 'Preparations',
            'name_ar' => 'المستحضرات',
            'display_order' => 90,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('ingredient_categories')
            ->whereNull('organisation_id')
            ->where('code', self::CODE)
            ->whereNotExists(static function ($query): void {
                $query->selectRaw('1')
                    ->from('ingredients')
                    ->whereColumn('ingredients.ingredient_category_id', 'ingredient_categories.id')
                    ->orWhereColumn('ingredients.ingredient_subcategory_id', 'ingredient_categories.id');
            })
            ->delete();
    }
};
