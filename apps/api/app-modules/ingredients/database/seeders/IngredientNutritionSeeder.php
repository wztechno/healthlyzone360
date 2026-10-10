<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Seeders;

use Healthy360\Ingredients\Services\IngredientNutritionImporter;
use Healthy360\Ingredients\Services\IngredientNutritionImportReport;
use Illuminate\Database\Seeder;

/**
 * Per-100 g nutrition for the 306 platform ingredients, and the 13 densities
 * that make a line stated in litres weighable.
 *
 * The figures come from the owner's reference table
 * (`scripts/convert-nutrition-table.py` → `data/platform-ingredient-nutrition.json`),
 * which is USDA FoodData Central with Open Food Facts behind it for the rows
 * USDA does not carry. Nothing is computed here: a number in the document is
 * the number in the column.
 *
 * ## Why it is a second seeder rather than columns on the master document
 *
 * `platform-ingredients.json` is regenerated from a workbook that is not in
 * this repository, and that workbook has no nutrition in it. Folding these
 * values into that document would mean the next `pnpm gen:v6` silently deleted
 * them. Two documents, two generators, joined on `source_ref` — and
 * `IngredientMasterSeeder` keeps writing `nutrition_per_100g => null` on
 * insert, which is what leaves this one something to fill.
 *
 * ## The row logic lives in {@see IngredientNutritionImporter}
 *
 * Fill-empty, per column, independently (risk R8); the density written only
 * while the row still stocks in the unit the figure was measured against;
 * derived rows left to the recipe that owns them; every row it changed pushed
 * through the derivation invalidator. All of it is the importer's, because a
 * seeder is not the only thing that has to apply this document —
 * `ingredients:import-nutrition` applies it on demand, and that is also where
 * the overwrite mode lives. **This seeder never overwrites.** Re-applying a
 * changed source file to a filled database is a different operation with a
 * different risk, and a deployment is not the moment to decide to take it.
 *
 * On demand:
 *
 * ```
 * php artisan db:seed --class="Healthy360\Ingredients\Database\Seeders\IngredientNutritionSeeder" --force
 * php artisan ingredients:import-nutrition --dry-run   # the same document, with the overwrite mode
 * ```
 */
class IngredientNutritionSeeder extends Seeder
{
    public function run(): void
    {
        $this->report(app(IngredientNutritionImporter::class)->apply(overwrite: false));
    }

    private function report(IngredientNutritionImportReport $report): void
    {
        $this->command?->info(sprintf(
            'Platform ingredient nutrition: %d of %d rows filled, %d already carried facts. '
            .'%d densities written, %d skipped because the row no longer stocks in the unit the figure was measured against. '
            .'%d published recipe versions marked stale; the widest single fan-out reached %d organisations.',
            $report->filled,
            $report->rows,
            $report->rows - $report->filled,
            $report->densitiesFilled,
            $report->skippedUnitMismatch,
            $report->versionsMarked,
            $report->organisationsReached,
        ));

        // The buckets a fill-empty run can only ever report as zero or as a
        // reason it did nothing. Printed anyway: "0 left curated" is what tells
        // an operator the seeder had nothing it was declining to touch, and a
        // non-zero one is the pointer at `ingredients:import-nutrition`.
        $this->command?->info(sprintf(
            '%d rows left as somebody curated them, %d left to the recipe version that derives them.',
            $report->leftCurated,
            $report->leftDerived,
        ));

        $this->command?->warn(sprintf(
            '%d of the %d rows are flagged estimated by the source — recipe-, brand-, salt- or preparation-dependent '
            .'figures rather than measured ones. The flag and the source note now land on the rows themselves '
            .'(`nutrition_estimated`, `nutrition_note`), so the kitchen can see which they are; replace one with a '
            .'supplier label before it reaches a printed panel.',
            $report->estimated,
            $report->rows,
        ));
    }
}
