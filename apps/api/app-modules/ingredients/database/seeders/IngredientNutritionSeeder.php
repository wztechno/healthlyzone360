<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Seeders;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Services\IngredientDerivationInvalidator;
use Healthy360\ReferenceData\Database\Seeders\SeedDataFile;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Per-100 g nutrition for the 306 platform ingredients, and the 20 densities
 * that make a volume or per-piece line weighable.
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
 * ## Fill-empty, per column, independently
 *
 * Insert-if-absent like the seeder it follows (risk R8). A row whose facts an
 * operator has corrected keeps the correction through every redeployment, and
 * the two columns are decided separately: an ingredient can have curated
 * nutrition and no density, or the reverse, and neither answer blocks the
 * other. There is deliberately **no overwrite mode** — re-applying a changed
 * source file to a filled database is a different operation with a different
 * risk, and it should be written when somebody actually needs it rather than
 * left lying around as a flag.
 *
 * ## The density is written only while the unit still agrees
 *
 * `grams_per_unit` is grams per one `default_unit`, and the document states
 * which unit each figure was measured against (`grams_per_unit_of`: `l` for
 * nineteen, `piece` for eggs). If a kitchen has since re-stocked soya sauce by the
 * millilitre, writing 1080 would be wrong by a factor of a thousand and would
 * look exactly like a correct row. Those rows are skipped and counted, never
 * relabelled. It is the same rule `IngredientCatalogueService::update()`
 * applies from the other end when the unit changes.
 *
 * ## It invalidates what it filled
 *
 * A published recipe version's derived figures are only as good as the
 * ingredient facts they were computed from, so every row this seeder fills is
 * pushed through {@see IngredientDerivationInvalidator}. On a fresh
 * `--seed` no recipes exist and it is a no-op; run by name against a live
 * stack it marks every published version using those ingredients stale and
 * queues the recompute, which **needs the queue worker up** or the snapshots
 * stay stale until the next publish.
 *
 * On demand:
 *
 * ```
 * php artisan db:seed --class="Healthy360\Ingredients\Database\Seeders\IngredientNutritionSeeder" --force
 * ```
 */
class IngredientNutritionSeeder extends Seeder
{
    /**
     * The seven nutrients an envelope carries, in the order they are written:
     * document key → `nutrient_id` and its canonical unit.
     *
     * Canonical, not merely conventional. The roll-up that reads these treats
     * an ingredient stating energy in kJ as unusable rather than converting it,
     * so the unit written here is part of the contract and not a label.
     * `saturated_fat` is absent because the source table has no column for it,
     * and a nutrient nobody supplied must be missing rather than zero.
     *
     * @var array<string, array{string, string}>
     */
    private const array NUTRIENTS = [
        'energy_kcal' => ['energy', 'kcal'],
        'protein_g' => ['protein', 'g'],
        'carbohydrate_g' => ['carbohydrate', 'g'],
        'fat_g' => ['fat', 'g'],
        'fibre_g' => ['fibre', 'g'],
        'sugars_g' => ['sugars', 'g'],
        'sodium_mg' => ['sodium', 'mg'],
    ];

    public function run(): void
    {
        $document = SeedDataFile::documentIn(dirname(__DIR__).'/data', 'platform-ingredient-nutrition');
        $rows = SeedDataFile::rowList($document, 'ingredients');

        $library = Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('source_system', IngredientMasterSeeder::SOURCE_SYSTEM)
            ->with('defaultUnit')
            ->get()
            ->keyBy('source_ref');

        $filled = 0;
        $densities = 0;
        $unitMismatches = 0;
        $estimated = 0;

        /** @var list<Ingredient> $touched */
        $touched = [];

        foreach ($rows as $row) {
            $sourceRef = SeedDataFile::string($row, 'source_ref');
            $ingredient = $library->get($sourceRef);

            if (! $ingredient instanceof Ingredient) {
                throw new RuntimeException(
                    "Nutrition document names ingredient [{$sourceRef}], which the platform library does not carry."
                );
            }

            if ($row['estimated'] ?? false) {
                $estimated++;
            }

            // A row whose facts a published recipe version derives is that
            // recipe's to state, and reference data must not write over a
            // derivation: the next recompute would overwrite this seeder's
            // figure anyway, and in between the ingredient would disagree with
            // the formulation that defines it. No platform row is ever in that
            // position — outputs are a kitchen's own intermediates — so this is
            // a guard against the day one is, not a case being handled.
            if ($ingredient->nutrition_derived_from_version_id !== null) {
                continue;
            }

            if ($ingredient->nutrition_per_100g === null) {
                $ingredient->nutrition_per_100g = $this->envelope($row);
                $filled++;
            }

            $grams = $row['grams_per_unit'] ?? null;

            if ($ingredient->grams_per_unit === null && is_numeric($grams)) {
                if ($ingredient->defaultUnit?->code === ($row['grams_per_unit_of'] ?? null)) {
                    $ingredient->grams_per_unit = (string) $grams;
                    $densities++;
                } else {
                    $unitMismatches++;
                }
            }

            if (! $ingredient->isDirty()) {
                continue;
            }

            $ingredient->save();
            $touched[] = $ingredient;
        }

        $this->report($rows, $filled, $densities, $unitMismatches, $estimated, $this->invalidate($touched));
    }

    /**
     * The slim per-100 g envelope `ingredients.nutrition_per_100g` holds, in
     * the shape `StoreIngredientRequest::nutritionRules()` validates on the
     * write path: a basis and a flat list of amounts, nothing nested.
     *
     * @param  array<array-key, mixed>  $row
     * @return array{basis: string, amounts: list<array{nutrient_id: string, unit: string, value: float|int}>}
     */
    private function envelope(array $row): array
    {
        $amounts = [];

        foreach (self::NUTRIENTS as $key => [$nutrientId, $unit]) {
            $value = $row[$key] ?? null;

            if (! is_int($value) && ! is_float($value)) {
                throw new RuntimeException(sprintf(
                    'Nutrition document row [%s] has no numeric [%s].',
                    SeedDataFile::string($row, 'source_ref'),
                    $key,
                ));
            }

            $amounts[] = ['nutrient_id' => $nutrientId, 'unit' => $unit, 'value' => $value];
        }

        return ['basis' => 'per_100g', 'amounts' => $amounts];
    }

    /**
     * Mark every derivation built on the rows this run filled.
     *
     * The layer passed is the row's own owner, which is NULL for all 306 of
     * them: a change to a platform ingredient's facts reaches every kitchen
     * that uses it, so the invalidator fans out across tenants rather than
     * marking inside the (absent) console context.
     *
     * The second figure is the widest single fan-out rather than the union:
     * the invalidator reports how many organisations a change reached, never
     * which, so there is nothing to take a union of. It is a sense of scale for
     * an operator watching the run, and the version count beside it is exact.
     *
     * @param  list<Ingredient>  $ingredients
     * @return array{0: int, 1: int} versions marked, widest fan-out
     */
    private function invalidate(array $ingredients): array
    {
        $invalidator = app(IngredientDerivationInvalidator::class);

        $versions = 0;
        $organisations = 0;

        foreach ($ingredients as $ingredient) {
            [$marked, $reached] = $invalidator->invalidate($ingredient, $ingredient->organisation_id);

            $versions += count($marked);
            $organisations = max($organisations, $reached);
        }

        return [$versions, $organisations];
    }

    /**
     * @param  list<array<array-key, mixed>>  $rows
     * @param  array{0: int, 1: int}  $invalidated
     */
    private function report(array $rows, int $filled, int $densities, int $unitMismatches, int $estimated, array $invalidated): void
    {
        [$versions, $organisations] = $invalidated;

        $this->command?->info(sprintf(
            'Platform ingredient nutrition: %d of %d rows filled, %d already carried facts. '
            .'%d densities written, %d skipped because the row no longer stocks in the unit the figure was measured against. '
            .'%d published recipe versions marked stale; the widest single fan-out reached %d organisations.',
            $filled,
            count($rows),
            count($rows) - $filled,
            $densities,
            $unitMismatches,
            $versions,
            $organisations,
        ));

        $this->command?->warn(sprintf(
            '%d of the %d rows are flagged estimated by the source — recipe-, brand-, salt- or preparation-dependent '
            .'figures rather than measured ones. The flag stays in the seed document; replace one with a supplier label '
            .'before it reaches a printed panel.',
            $estimated,
            count($rows),
        ));
    }
}
