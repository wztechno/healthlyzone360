<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Procurement\Services\IngredientCostService;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

/**
 * What the KG/LTR unit migration would do to *this* database, without doing any of it.
 *
 * ## Why this exists before the migration does
 *
 * The seed document already stocks every platform ingredient in kilograms or litres, so a fresh
 * install is correct by construction. A database that has been trading is the hard case, and the
 * hard part is not the ingredient rows — it is everything denominated against them:
 *
 * - `ingredient_stock_costs` holds `quantity_on_hand` and a moving average *per one of the
 *   ingredient's units*. Move the unit and the two stop describing the same thing. Where the old
 *   and new units convert, {@see IngredientCostService} rebases
 *   exactly; where they do not — `piece` to `kg`, and there is no per-piece weight in this system —
 *   it refuses, and the next goods receipt for that ingredient fails until somebody counts the
 *   shelf. That table has two writers, no admin surface and no reset, so the count of rows in that
 *   state is the blast radius of the whole migration.
 * - `stock_items` keep their unit once anything has been counted
 *   ({@see StockItemDerivationService::refresh()}), which is correct
 *   and conservative and means a counted shelf will sit in the old unit while its ingredient moves.
 * - `recipe_version_lines` in a retiring unit can be converted where a density proves the figure
 *   and must be quarantined where nothing does.
 *
 * None of that is knowable from the repository. It is a property of a deployed kitchen, so this
 * reports it and changes nothing.
 *
 * ## Why it lives in `kitchens`
 *
 * It reads ingredients, inventory and recipes together, and `ingredients` is the layer the other
 * two depend on — putting it there would make the lowest module import from the ones above it.
 * `kitchens` is where the commands that operate across a whole kitchen already live, alongside
 * `PriceRecipesFromCatalogueCommand`, which crosses the same boundaries for the same reason.
 *
 * ## Read-only, and deliberately so
 *
 * No writes, no transaction, no `--fix`. The output is the artefact an operator signs before the
 * migration runs; a command that could also perform the change would invite running it without
 * reading it.
 */
final class UnitNormalisationReportCommand extends Command
{
    protected $signature = 'kitchen:unit-report {--json : Machine-readable output for a PR artefact}';

    protected $description = 'Report what the KG/LTR unit normalisation would move in this database, and what it would strand';

    /**
     * The thirteen rows the owner's table stocks by the litre. Everything else in the `ING-` series
     * is kilograms — including the five edible oils, which were considered for litres and
     * deliberately left as mass.
     */
    private const array LITRE_REFS = [
        'ING-003', 'ING-012', 'ING-013', 'ING-023', 'ING-025', 'ING-026', 'ING-030',
        'ING-031', 'ING-032', 'ING-033', 'ING-034', 'ING-062', 'ING-067',
    ];

    public function handle(UnitConversionService $conversion): int
    {
        $units = MeasurementUnit::query()->get()->keyBy(fn (MeasurementUnit $u): string => (string) $u->getKey());
        $byCode = $units->keyBy('code');

        /*
         * Platform rows only, and the `source_system` guard is not decoration: a tenant fork takes
         * the next `ING-` number in *that organisation's* own sequence with a null source system,
         * so the reference alone would match a kitchen's own row and this report would promise to
         * rewrite it.
         */
        $ingredients = Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('source_system', 'healthy360_platform')
            ->where('source_ref', '~', '^ING-[0-9]+$')
            ->get(['id', 'source_ref', 'name_en', 'default_unit_id', 'purchase_unit_id', 'grams_per_unit']);

        $moving = [];

        foreach ($ingredients as $ingredient) {
            $target = in_array($ingredient->source_ref, self::LITRE_REFS, true) ? 'l' : 'kg';
            $current = $units->get((string) $ingredient->default_unit_id);
            $purchase = $ingredient->purchase_unit_id === null
                ? null
                : $units->get((string) $ingredient->purchase_unit_id);

            if ($current?->code === $target && ($purchase === null || $purchase->code === $target)) {
                continue;
            }

            $moving[(string) $ingredient->getKey()] = [
                'ref' => $ingredient->source_ref,
                'name' => $ingredient->name_en,
                'from' => $current instanceof MeasurementUnit ? $current->code : '(none)',
                'purchase_from' => $purchase?->code,
                'to' => $target,
                'convertible' => $current instanceof MeasurementUnit
                    && $conversion->canConvert($current, $byCode->get($target)),
            ];
        }

        $stranded = $moving === [] ? [] : $this->strandedCosts($moving, $units, $conversion);
        $shelves = $moving === [] ? [] : $this->mismatchedShelves($moving, $units);
        $lines = $moving === []
            ? ['convertible' => 0, 'unresolvable' => 0, 'unresolvable_on_published_versions' => 0, 'examples' => []]
            : $this->affectedRecipeLines($moving, $units, $conversion);

        /*
         * JSON is emitted whatever the answer, including "nothing to do".
         *
         * This output is an artefact a script or a PR reads, and the clean case is the one most
         * likely to be run in anger — against a database somebody believes is already fine. An
         * early return that printed a sentence instead would break every consumer on exactly the
         * answer they were hoping for.
         */
        if ($this->option('json')) {
            $this->line((string) json_encode([
                'moving' => array_values($moving),
                'stranded_costs' => $stranded,
                'counted_shelves' => $shelves,
                'recipe_lines' => $lines,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return self::SUCCESS;
        }

        $this->components->info(sprintf('%d platform ingredient(s) would move unit.', count($moving)));

        if ($moving === []) {
            $this->components->info('Nothing to report: this database already matches the owner unit table.');

            return self::SUCCESS;
        }

        $this->renderStranded($stranded);
        $this->renderShelves($shelves);
        $this->renderLines($lines);

        $this->newLine();
        // The verdict is the line an operator reads first, so its tone has to match its content: an
        // all-clear drawn as a warning trains people to skim past the one that is not.
        $needsRecount = array_filter($shelves, static fn (array $row): bool => $row['needs_recount'] === true);

        if ($stranded === [] && $needsRecount === []) {
            $this->components->info('No held balance is at risk. The migration is a units-and-lines change on this database.');
        } else {
            $this->components->error('Balances above are at risk. They are the reason this migration needs a signed rehearsal, not a deploy.');
        }

        return self::SUCCESS;
    }

    /**
     * Cost balances the migration would leave in a unit nothing can rebase.
     *
     * A zero balance is excluded on purpose, and it is not a rounding convenience: with nothing on
     * the shelf there is no quantity to carry and no average to misapply, so the row simply adopts
     * the new unit on the next receipt. Only a non-zero balance in a non-convertible unit is stuck.
     *
     * @param  array<string, array<string, mixed>>  $moving
     * @param  Collection<string, MeasurementUnit>  $units
     * @return list<array<string, mixed>>
     */
    private function strandedCosts(array $moving, $units, UnitConversionService $conversion): array
    {
        $rows = [];

        foreach (
            IngredientStockCost::withoutTenancy()
                ->whereIn('ingredient_id', array_keys($moving))
                ->get() as $cost
        ) {
            $ingredient = $moving[(string) $cost->ingredient_id];
            $held = $units->get((string) $cost->unit_id);
            $target = $units->firstWhere('code', $ingredient['to']);

            if (! $held instanceof MeasurementUnit || ! $target instanceof MeasurementUnit) {
                continue;
            }
            if (bccomp((string) $cost->quantity_on_hand, '0', 6) === 0) {
                continue;
            }
            if ($conversion->canConvert($held, $target)) {
                continue;
            }

            $average = (string) ($cost->moving_average_cost_amount ?? '0');

            $rows[] = [
                'ref' => $ingredient['ref'],
                'name' => $ingredient['name'],
                'organisation_id' => (string) $cost->organisation_id,
                'held_unit' => $held->code,
                'target_unit' => $target->code,
                'quantity_on_hand' => (string) $cost->quantity_on_hand,
                // The figure that decides whether this is a nuisance or a write-off.
                'value_at_risk' => bcmul((string) $cost->quantity_on_hand, $average, 6),
                'currency' => $cost->currency_code,
            ];
        }

        return $rows;
    }

    /**
     * Shelves that have been counted, so derivation will leave them in the old unit.
     *
     * The mismatch this produces is quiet rather than loud, which is what makes it worth listing:
     * `MealExplosion` converts a recipe line into the shelf's unit, fails, and emits
     * `unit_conversion_unsupported` — a *non-blocking* reason whenever any other ingredient on the
     * line deducted. The order confirms, that one shelf never moves, and the exception settles
     * itself on the next retry. Nothing reconciles the difference afterwards.
     *
     * @param  array<string, array<string, mixed>>  $moving
     * @param  Collection<string, MeasurementUnit>  $units
     * @return list<array<string, mixed>>
     */
    private function mismatchedShelves(array $moving, $units): array
    {
        $rows = [];

        foreach (
            StockItem::withoutTenancy()
                ->whereIn('ingredient_id', array_keys($moving))
                ->get() as $item
        ) {
            $ingredient = $moving[(string) $item->ingredient_id];
            $shelfUnit = $units->get((string) $item->unit_id);

            if ($shelfUnit?->code === $ingredient['to']) {
                continue;
            }

            $counted = StockLevel::withoutTenancy()
                ->where('stock_item_id', $item->getKey())
                ->where('quantity', '!=', 0)
                ->sum('quantity');

            $rows[] = [
                'ref' => $ingredient['ref'],
                'name' => $ingredient['name'],
                'stock_item_code' => $item->code,
                // The free-text shadow column, when the relation has nothing to say — it is what
                // the stock list itself displays, so it is what an operator will recognise.
                'shelf_unit' => $shelfUnit instanceof MeasurementUnit ? $shelfUnit->code : $item->unit_code,
                'target_unit' => $ingredient['to'],
                'counted' => (string) $counted,
                // Derivation moves an uncounted shelf on its own; a counted one needs a human.
                'needs_recount' => bccomp((string) $counted, '0', 4) !== 0,
            ];
        }

        return $rows;
    }

    /**
     * Recipe lines measured in a unit their ingredient is leaving.
     *
     * Split by what the data can prove. A line convertible into the new unit — grams into
     * kilograms, millilitres into litres — is arithmetic. A line the density bridges is arithmetic
     * too. A line with neither is the quarantine case, and the count of *published* versions among
     * them is the number that matters most: a published version is immutable, so those cannot be
     * converted in place at all.
     *
     * @param  array<string, array<string, mixed>>  $moving
     * @param  Collection<string, MeasurementUnit>  $units
     * @return array<string, mixed>
     */
    private function affectedRecipeLines(array $moving, $units, UnitConversionService $conversion): array
    {
        $convertible = 0;
        $unresolvable = 0;
        $publishedUnresolvable = 0;
        $examples = [];

        /*
         * `toBase()`, because a joined row carrying an aliased column is a report row rather than a
         * `RecipeVersionLine` — hydrating it as one would invent a model with a property the class
         * does not declare. `withoutTenancy()` still applies: this reads every kitchen at once,
         * which is the question being asked.
         */
        $rows = RecipeVersionLine::withoutTenancy()
            ->whereIn('recipe_version_lines.ingredient_id', array_keys($moving))
            ->join('recipe_versions', 'recipe_versions.id', '=', 'recipe_version_lines.recipe_version_id')
            ->where('recipe_versions.status', '!=', RecipeVersionStatus::Retired->value)
            ->toBase()
            ->get([
                'recipe_version_lines.ingredient_id',
                'recipe_version_lines.unit_id',
                'recipe_version_lines.line_number',
                'recipe_versions.status as version_status',
            ]);

        foreach ($rows as $row) {
            $ingredient = $moving[(string) $row->ingredient_id];
            $lineUnit = $units->get((string) $row->unit_id);
            $target = $units->firstWhere('code', $ingredient['to']);

            if (! $lineUnit instanceof MeasurementUnit || ! $target instanceof MeasurementUnit) {
                continue;
            }
            if ($conversion->canConvert($lineUnit, $target)) {
                $convertible++;

                continue;
            }

            $unresolvable++;

            if ($row->version_status === RecipeVersionStatus::Published->value) {
                $publishedUnresolvable++;
            }

            if (count($examples) < 10) {
                $examples[] = sprintf(
                    '%s line %d in %s (version %s)',
                    $ingredient['ref'],
                    $row->line_number,
                    $lineUnit->code,
                    $row->version_status,
                );
            }
        }

        return [
            'convertible' => $convertible,
            'unresolvable' => $unresolvable,
            'unresolvable_on_published_versions' => $publishedUnresolvable,
            'examples' => $examples,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $stranded
     */
    private function renderStranded(array $stranded): void
    {
        $this->newLine();
        $this->components->twoColumnDetail('<options=bold>Cost balances that cannot be rebased</>', (string) count($stranded));

        if ($stranded === []) {
            $this->components->twoColumnDetail('  none', 'every held balance is zero or convertible');

            return;
        }

        foreach ($stranded as $row) {
            $this->components->twoColumnDetail(
                sprintf('  %s %s', $row['ref'], $row['name']),
                sprintf(
                    '%s %s -> %s, worth %s %s',
                    $row['quantity_on_hand'],
                    $row['held_unit'],
                    $row['target_unit'],
                    $row['value_at_risk'],
                    $row['currency'] ?? '(no currency)',
                ),
            );
        }
    }

    /**
     * @param  list<array<string, mixed>>  $shelves
     */
    private function renderShelves(array $shelves): void
    {
        $needing = array_values(array_filter($shelves, static fn (array $row): bool => $row['needs_recount'] === true));

        $this->newLine();
        $this->components->twoColumnDetail('<options=bold>Counted shelves needing a recount</>', (string) count($needing));

        foreach ($needing as $row) {
            $this->components->twoColumnDetail(
                sprintf('  %s %s', $row['ref'], $row['name']),
                sprintf('%s holds %s %s, ingredient moves to %s', $row['stock_item_code'], $row['counted'], $row['shelf_unit'], $row['target_unit']),
            );
        }

        $uncounted = count($shelves) - count($needing);

        if ($uncounted > 0) {
            $this->components->twoColumnDetail('  uncounted shelves', sprintf('%d, derivation moves these itself', $uncounted));
        }
    }

    /**
     * @param  array<string, mixed>  $lines
     */
    private function renderLines(array $lines): void
    {
        $this->newLine();
        $this->components->twoColumnDetail('<options=bold>Recipe lines in a retiring unit</>', '');
        $this->components->twoColumnDetail('  convertible', (string) $lines['convertible']);
        $this->components->twoColumnDetail('  unresolvable (would quarantine)', (string) $lines['unresolvable']);
        $this->components->twoColumnDetail(
            '  of those, on published versions',
            sprintf('%d — immutable, cannot be converted in place', $lines['unresolvable_on_published_versions']),
        );

        foreach ($lines['examples'] as $example) {
            $this->components->twoColumnDetail('    e.g.', $example);
        }
    }
}
