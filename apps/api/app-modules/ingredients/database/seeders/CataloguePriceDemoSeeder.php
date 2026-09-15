<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Seeders;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientCategory;
use Illuminate\Database\Seeder;

/**
 * Synthetic prices for the platform library, so recipe costing can be exercised.
 *
 * # These figures are invented. Read this before trusting one.
 *
 * The v6 workbook has **no ingredient prices at all**: sheet 1 carries a `Price`
 * column and it is empty in all 306 rows, and sheet 6 has no price column to be
 * empty. The only real money in the source belongs to the sellable sheets —
 * 31 B2B/B2C figures across Sauce, Dressing and Production — and those land on
 * `catalogue_items`, not here. So there was nothing to transcribe, and
 * `IngredientMasterSeeder` correctly leaves every price NULL rather than
 * inventing one.
 *
 * A recipe cost of zero is not testable though, and that is what this exists
 * for. Every figure below is **fabricated**: a deterministic pseudo-random pick
 * inside a per-category band that a reasonable person would not blink at. They
 * are plausible, which is precisely what makes them dangerous — nothing about a
 * seeded row says "made up" once it is on screen. Treat any cost report built on
 * them as a demonstration that the arithmetic works, never as a number.
 *
 * # Why it is not in DatabaseSeeder
 *
 * `IngredientMasterSeeder`'s docblock states that the committed library
 * "contains no quantified formulation, no cost, no supplier and no yield" and is
 * production-safe under the data register's mechanism (a). Folding invented
 * money into that file, or into the default seed chain, would make that sentence
 * false and would ship fabricated commercial data to production. So this is
 * opt-in and run by name:
 *
 * ```
 * php artisan db:seed --class="Healthy360\Ingredients\Database\Seeders\CataloguePriceDemoSeeder"
 * ```
 *
 * # What it writes
 *
 * `unit_price_amount` on every platform row that has none — the figure recipe
 * costing divides by, and the one that actually matters for the test. B2B and
 * B2C follow as fixed markups over it, so the three are at least consistent with
 * each other; a catalogue where the trade price undercut the cost would be its
 * own distraction while reading a cost report.
 *
 * **Insert-if-absent, like the seeder it complements.** A row that already
 * carries a price is left exactly as it is, so an operator's real figure is
 * never overwritten by an invented one. That is also what makes it safe to run
 * twice.
 */
class CataloguePriceDemoSeeder extends Seeder
{
    /**
     * The workbook quotes its sellable prices in US$ and the nine rows already
     * priced in this database are USD, so the invented ones match rather than
     * introducing a second currency nobody chose.
     */
    private const string CURRENCY = 'USD';

    /**
     * Per-category bands, in major units of {@see CURRENCY}, for one unit of the
     * row's own measure — a kilogram for most food, a piece for packaging.
     *
     * Chosen to be unremarkable rather than accurate: saffron and parsley share
     * the `herb-spice` band, which is wrong by two orders of magnitude and does
     * not matter, because the point is that a recipe multiplies a quantity by a
     * number and gets a total. A band per category is enough for the totals to
     * be differently-sized, which is what makes a cost report readable enough to
     * check.
     *
     * @var array<string, array{float, float}>
     */
    private const array BANDS = [
        'vegetable' => [0.80, 4.50],
        'fruit' => [1.20, 6.00],
        'herb-spice' => [4.00, 28.00],
        'condiment-sweetener' => [1.50, 9.00],
        'grain-starch' => [0.90, 4.00],
        'dairy' => [2.50, 12.00],
        'nut-seed' => [6.00, 22.00],
        'meat-egg' => [4.50, 18.00],
        'oil-fat-stock' => [2.00, 11.00],
        'baking-starch' => [1.50, 7.00],
        'fish-seafood' => [7.00, 26.00],
        'legume' => [1.00, 4.50],
        'desserts' => [3.00, 10.00],
        // Per piece, not per kilo: a bag costs cents, and a band shared with
        // food would make packaging dominate every cost report it appeared in.
        'packaging-disposables' => [0.02, 0.55],
    ];

    /** The band for a row whose category is not listed above. */
    private const array DEFAULT_BAND = [1.00, 8.00];

    /** Trade sits above cost, retail above trade. Round numbers; nothing is modelled. */
    private const float B2B_MARKUP = 1.35;

    private const float B2C_MARKUP = 1.90;

    public function run(): void
    {
        $categoryCodes = $this->categoryCodesById();
        $priced = 0;

        Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->whereNull('unit_price_amount')
            ->orderBy('source_ref')
            ->chunkById(200, function ($rows) use ($categoryCodes, &$priced): void {
                foreach ($rows as $row) {
                    $code = $categoryCodes[$row->ingredient_category_id] ?? null;
                    $unit = $this->priceFor($row->source_ref ?? $row->slug, $code);

                    $row->unit_price_amount = number_format($unit, 4, '.', '');
                    $row->b2b_price_amount = number_format($unit * self::B2B_MARKUP, 4, '.', '');
                    $row->b2c_price_amount = number_format($unit * self::B2C_MARKUP, 4, '.', '');
                    $row->price_currency_code = self::CURRENCY;
                    $row->save();

                    $priced++;
                }
            });

        $this->command?->info("Priced {$priced} platform rows with synthetic figures (".self::CURRENCY.').');
        $this->command?->warn('These prices are invented — the v6 workbook carries none. Do not report them as real.');
    }

    /**
     * A stable figure inside the row's band.
     *
     * Derived from the row's own reference rather than randomly, so a second run
     * on a fresh database produces the same catalogue. A cost report that moved
     * every time somebody reseeded would be useless as a thing to compare
     * against while changing recipe arithmetic.
     */
    private function priceFor(string $seed, ?string $categoryCode): float
    {
        [$low, $high] = self::BANDS[$categoryCode] ?? self::DEFAULT_BAND;

        // crc32 rather than a cryptographic hash: this needs to be repeatable
        // and evenly spread, not unpredictable.
        $fraction = (crc32($seed) % 10_000) / 10_000;

        return round($low + ($high - $low) * $fraction, 2);
    }

    /**
     * @return array<string, string> category id → top-level code
     */
    private function categoryCodesById(): array
    {
        $codes = [];
        $parents = [];

        foreach (IngredientCategory::withoutTenancy()->get() as $category) {
            $codes[(string) $category->getKey()] = $category->code;
            $parents[(string) $category->getKey()] = $category->parent_id;
        }

        // A row filed at a leaf takes its parent's band: the bands are stated
        // per top-level branch, and "packaging-disposables-bags" is not one.
        foreach ($codes as $id => $code) {
            $parentId = $parents[$id] ?? null;

            if ($parentId !== null && isset($codes[$parentId])) {
                $codes[$id] = $codes[$parentId];
            }
        }

        return $codes;
    }
}
