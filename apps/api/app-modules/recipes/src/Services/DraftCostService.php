<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Exceptions\MixedCostCurrency;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;

/**
 * What a recipe **that does not exist yet** costs.
 *
 * The source workbook's cost block, run over a draft: the ingredient lines
 * totalled and divided by the yield with the process coefficient on them, the
 * packaging lines totalled and divided by the *same* yield with the packaging
 * coefficient on them, and the two added. Cells `E23`, `B25`–`B27`, `E33`,
 * `B35`–`B37` and `B39` of `Thousand Islands`, in that order.
 *
 * ## Nothing here computes anything
 *
 * That is the whole design. Every figure comes from {@see RecipeCostingService}
 * over rows resolved by {@see RecipeVersionService::prepareLines()} and
 * {@see RecipeVersionService::preparePackaging()} — the same two methods a save
 * runs. This class only assembles: it builds an **unsaved** `RecipeVersion`
 * carrying the draft's yield and coefficients, hangs unsaved line and packaging
 * models off it, and hands the three of them to the costing service.
 *
 * The alternative — a second implementation for the preview — is the thing this
 * exists to prevent. A kitchen that is shown one cost while typing and a
 * different one after saving has been taught that neither figure is the cost,
 * and the source workbook's own drift between its two tables is the evidence
 * for how that ends.
 *
 * ## Unsaved models are load-bearing, not a trick
 *
 * `RecipeCostingService` reads attributes and never the database: both of its
 * entry points take a pre-loaded collection precisely so the publish path can
 * avoid a second query. Passing rows that were never persisted uses that same
 * door. Nothing here touches a transaction, an audit trail, or a lock version,
 * because nothing here is a write.
 */
final readonly class DraftCostService
{
    public function __construct(
        private RecipeVersionService $versions,
        private RecipeCostingService $costing,
        private PackCost $packCost,
        private TenantContext $context,
    ) {}

    /**
     * Cost one draft.
     *
     * Returns `null` when the draft states no yield: every figure in the block
     * below the two line totals is *something over the yield*, so without one
     * there is no cost block to show — only two totals, which the roll-up's
     * `estimated_cost` already carries. Saying nothing is the honest answer;
     * showing the totals under headings that promise per-kilo figures is not.
     *
     * @param  list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null}>  $lines
     * @param  list<array{ingredient_id: string, basis: string, quantity?: float|string|null}>  $packaging
     * @param  list<array{key: string, fill_quantity: float|int|string, fill_unit: string, components: list<array{ingredient_id: string, quantity: float|int|string, is_container: bool}>}>  $packs  costed by {@see PackCost} over this draft's production half
     * @return array{production: CostComputation, packaging: PackagingCostComputation, total: numeric-string|null, packages: list<array{line_number: int, ingredient_id: string, cost_per_package_amount: numeric-string|null}>, packs: list<array{key: string, contents_amount: numeric-string|null, packaging_amount: numeric-string|null, cost_amount: numeric-string|null, withheld_reason: string|null}>, production_lines: list<array{line_number: int, ingredient_id: string, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null, cost_source: string|null, source_recipe: array{id: string, name_en: string, name_ar: string}|null}>, packaging_lines: list<array{line_number: int, ingredient_id: string, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null}>}|null
     *
     * @throws ApiException
     */
    public function cost(
        array $lines,
        array $packaging,
        ?string $yieldQuantity,
        ?string $yieldUnitId,
        ?int $yieldPieceCount,
        ?string $wastePercent,
        ?string $packagingWastePercent,
        array $packs = [],
    ): ?array {
        if ($yieldQuantity === null || $yieldUnitId === null || ! is_numeric($yieldQuantity) || bccomp($yieldQuantity, '0', 6) !== 1) {
            return null;
        }

        $version = $this->draftVersion(
            $yieldQuantity,
            $yieldUnitId,
            $yieldPieceCount,
            $wastePercent ?? '0',
            $packagingWastePercent ?? '0',
        );

        $prepared = $this->versions->prepareLines($lines);
        $lineRows = $this->lineRows($prepared);
        $packagingRows = $this->packagingRows($this->versions->preparePackaging($version, $packaging));

        try {
            $production = $this->costing->computeRecalculated($version, $lineRows);
        } catch (MixedCostCurrency) {
            /*
             * Reported as "nothing is costed" rather than thrown, which is the
             * opposite of what the save path does and is right for a preview.
             *
             * `setLines()` refuses a two-currency formulation because it is
             * about to persist one. A preview persists nothing and is being
             * asked on every keystroke, so the moment somebody picks a second
             * ingredient priced in another currency the whole pricing tab would
             * turn into an error where a warning belongs. The uncosted list
             * withholds the total and says which lines it cannot reconcile,
             * which is the same answer the sheet gives for an unpriced line.
             */
            return null;
        }

        $packagingCost = $this->costing->computePackaging($version, $packagingRows);

        return [
            'production' => $production,
            'packaging' => $packagingCost,
            'total' => $this->costing->totalCostPerYieldUnit($production, $packagingCost),
            'packages' => $this->costing->costPerPackage($version, $production, $packagingCost, $packagingRows),
            'packs' => $this->packCost->of((string) $version->organisation_id, $production, $packs),
            'production_lines' => $this->withSources($this->costing->lineCostsOf($lineRows), $prepared),
            'packaging_lines' => $this->costing->lineCostsOf($packagingRows),
        ];
    }

    /**
     * Each production line with where its cost came from (S6), and — for one costed from the
     * recipe that makes it — that recipe, so the editor can label a preparation line and send its
     * Fix to the right place. One query for every component recipe on the draft.
     *
     * @param  list<array{line_number: int, ingredient_id: string, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null}>  $costs
     * @param  list<array{line_number: int, cost_source: string|null, source_recipe_version_id: string|null, ...}>  $prepared
     * @return list<array{line_number: int, ingredient_id: string, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null, cost_source: string|null, source_recipe: array{id: string, name_en: string, name_ar: string}|null}>
     */
    private function withSources(array $costs, array $prepared): array
    {
        $byLine = [];
        $versionIds = [];

        foreach ($prepared as $row) {
            $byLine[$row['line_number']] = $row;

            if ($row['source_recipe_version_id'] !== null) {
                $versionIds[] = $row['source_recipe_version_id'];
            }
        }

        $recipes = $versionIds === [] ? collect() : RecipeVersion::withoutTenancy()
            ->join('recipes', 'recipes.id', '=', 'recipe_versions.recipe_id')
            ->whereIn('recipe_versions.id', array_values(array_unique($versionIds)))
            ->toBase()
            ->get(['recipe_versions.id as version_id', 'recipes.id', 'recipes.name_en', 'recipes.name_ar'])
            ->keyBy('version_id');

        return array_map(static function (array $line) use ($byLine, $recipes): array {
            $row = $byLine[$line['line_number']] ?? null;
            $recipe = $row === null || $row['source_recipe_version_id'] === null ? null : $recipes->get($row['source_recipe_version_id']);

            return $line + [
                'cost_source' => $row['cost_source'] ?? null,
                'source_recipe' => $recipe === null ? null : [
                    'id' => (string) $recipe->id,
                    'name_en' => (string) $recipe->name_en,
                    'name_ar' => (string) $recipe->name_ar,
                ],
            ];
        }, $costs);
    }

    /**
     * The version the draft would be, unsaved.
     *
     * Only the fields costing reads are set. Deliberately not `->save()`d and
     * deliberately not given a key: an id would make it addressable, and a row
     * nobody created must not be.
     *
     * @param  numeric-string  $yieldQuantity
     */
    private function draftVersion(
        string $yieldQuantity,
        string $yieldUnitId,
        ?int $yieldPieceCount,
        string $wastePercent,
        string $packagingWastePercent,
    ): RecipeVersion {
        $version = new RecipeVersion;
        $version->organisation_id = $this->context->organisationId();
        $version->yield_quantity = $yieldQuantity;
        $version->yield_unit_id = $yieldUnitId;
        $version->yield_piece_count = $yieldPieceCount;
        $version->waste_coefficient_percent = $wastePercent;
        $version->packaging_waste_percent = $packagingWastePercent;

        return $version;
    }

    /**
     * @param  list<array{line_number: int, ingredient_id: string, quantity: numeric-string|null, unit_id: string|null, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null, cost_currency_code: string|null, source_designation: string|null, comment: string|null, cost_source: string|null, source_recipe_version_id: string|null}>  $prepared
     * @return Collection<int, RecipeVersionLine>
     */
    private function lineRows(array $prepared): Collection
    {
        /** @var Collection<int, RecipeVersionLine> $rows */
        $rows = new Collection;

        foreach ($prepared as $attributes) {
            $row = new RecipeVersionLine;
            $row->line_number = $attributes['line_number'];
            $row->ingredient_id = $attributes['ingredient_id'];
            $row->quantity = $attributes['quantity'];
            $row->unit_id = $attributes['unit_id'];
            $row->unit_cost_amount = $attributes['unit_cost_amount'];
            $row->line_cost_amount = $attributes['line_cost_amount'];
            $row->cost_currency_code = $attributes['cost_currency_code'];

            $rows->push($row);
        }

        return $rows;
    }

    /**
     * @param  list<array{line_number: int, ingredient_id: string, basis: PackagingBasis, quantity: numeric-string, unit_id: string|null, unit_cost_amount: numeric-string|null, line_cost_amount: numeric-string|null, cost_currency_code: string|null, comment: string|null}>  $prepared
     * @return Collection<int, RecipeVersionPackaging>
     */
    private function packagingRows(array $prepared): Collection
    {
        /** @var Collection<int, RecipeVersionPackaging> $rows */
        $rows = new Collection;

        foreach ($prepared as $attributes) {
            $row = new RecipeVersionPackaging;
            $row->line_number = $attributes['line_number'];
            $row->ingredient_id = $attributes['ingredient_id'];
            $row->basis = $attributes['basis'];
            $row->quantity = (string) $attributes['quantity'];
            $row->unit_id = $attributes['unit_id'];
            $row->unit_cost_amount = $attributes['unit_cost_amount'];
            $row->line_cost_amount = $attributes['line_cost_amount'];
            $row->cost_currency_code = $attributes['cost_currency_code'];

            $rows->push($row);
        }

        return $rows;
    }
}
