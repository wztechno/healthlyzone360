<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * How much of what a meal takes off the shelf — the read half of stock
 * consumption, extracted from {@see OrderConsumptionService} without changing a
 * digit of its arithmetic.
 *
 * A meal explodes into its published recipe: sum the version's lines per
 * ingredient, divide by the yield piece count and scale by the item's portion
 * factor for a per-sold-unit quantity, apply the waste coefficient as a
 * per-unit multiplier, multiply by the number ordered — each ingredient
 * converted into its branch stock item's unit. What this class does *not* do is
 * write: it hands back quantities and refusals, and the caller decides whether
 * that means a stock movement (a confirmed order) or a number on a report (a
 * requirement forecast).
 *
 * That split is the whole reason the class exists. A forecast that re-derived
 * "how much flour does Tuesday need" with its own arithmetic would drift from
 * what the deduction actually takes, and the two figures would disagree on
 * exactly the recipes that are hardest to reason about. One explosion, two
 * readers.
 *
 * Three rules survive the move unchanged.
 *
 * 1. **bcmath, never floats.** Intermediate steps run at twelve places and
 *    round half away from zero to six exactly once, at the end — the same
 *    discipline as {@see RecipeCostingService} and {@see UnitConversionService}.
 * 2. **Group by unit before converting, and round once between.** Lines are
 *    summed within their own unit at twelve places, rounded to six, converted
 *    into the stock unit, and only then re-summed. Same-unit lines therefore
 *    sum before any rounding (the common case) while a mixed-unit recipe still
 *    totals correctly. Converting line by line instead would round once per
 *    line and quietly disagree with the deduction on any recipe that measures
 *    one ingredient two ways.
 * 3. **Never fabricate a quantity.** Every branch that cannot resolve a real
 *    number — no published recipe version, no piece count, an unquantified
 *    line, no branch stock item, no convertible unit — abandons that ingredient
 *    and records why. A made-up number never reaches a ledger or a report.
 *
 * A fourth rule joined them with `catalogue_items.portion_factor`:
 * **one sold unit = one yield piece × the item's portion factor.** A kitchen
 * that sells half a portion of the same recipe takes half the ingredients off
 * the shelf, and the column that says so is the same one the customer's
 * per-serving nutrition is scaled by — declared once, so a label claim and a
 * stock count cannot disagree about how big a portion is. The default is `1`,
 * which is the arithmetic this class had before the column existed.
 *
 * `SCALE`, `WORKING_SCALE`, {@see numeric()} and {@see round()} are duplicated
 * here rather than moved or shared. That is the house pattern — five services
 * carry their own copies (`UnitConversionService`, `RecipeCostingService`,
 * `IngredientCostService`, `InventoryService`, `OrderConsumptionService`) — and
 * moving them would have been worse than duplication here specifically:
 * `OrderConsumptionService` still needs all four for the resold-product path,
 * the COGS valuation and the cancellation reversal, so a move would have left
 * the write half reaching into the read half for its rounding rule.
 *
 * Reads are `withoutTenancy()` scoped explicitly to the organisation passed in:
 * consumption runs on the kitchen's own confirm, but a subscription-generated
 * order can flow through a job whose ambient tenant is not the seller, and a
 * forecast runs for an organisation it was told about rather than one it is
 * inside.
 *
 * @phpstan-import-type ConsumptionFailure from MealExplosionResult
 * @phpstan-import-type ExplodedIngredient from MealExplosionResult
 */
final readonly class MealExplosion
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(
        private UnitConversionService $conversion,
        private DerivedAllergenService $allergens,
    ) {}

    /**
     * Explode `$quantity` of `$meal` into per-stock-item quantities.
     *
     * `$version` is an escape hatch for a caller that has already read the
     * published version — a forecast exploding a month of menu days reads each
     * meal's recipe once rather than once per day. Left null, the published
     * version is resolved here, which is what a single order line wants.
     *
     * `$branchId` may be null: a stock item is an organisation-level row and
     * the branch only ever breaks a tie between two shelves for one ingredient
     * (see {@see resolveStockItem()}), so an explosion without a branch still
     * answers — deterministically, by code — rather than refusing. Callers that
     * need a *branch-true* answer are the ones that must insist on a branch.
     *
     * `$quantity` is narrowed by {@see numeric()} rather than declared
     * `numeric-string`, and deliberately *after* the two version guards: a meal
     * with no published recipe answers `no_recipe_version` whatever its order
     * line says, which is the order the deduction path has always run in.
     *
     * @param  string  $quantity  how many of this meal; a non-numeric value is a loud failure, never a free deduction
     */
    public function explode(string $organisationId, CatalogueItem $meal, string $quantity, ?string $branchId, ?RecipeVersion $version = null): MealExplosionResult
    {
        $version ??= $this->allergens->publishedVersion($meal);

        if (! $version instanceof RecipeVersion) {
            return new MealExplosionResult(failures: [
                $this->failure((string) $meal->getKey(), 'no_recipe_version', 'The meal links no published recipe version to explode into ingredients.'),
            ]);
        }

        $pieceCount = $version->yield_piece_count;

        if ($pieceCount === null || $pieceCount <= 0) {
            // Without a divisor there is no "per sold unit" — the exact blocker
            // the plan calls out. Recorded, never guessed as one.
            return new MealExplosionResult(failures: [
                $this->failure((string) $meal->getKey(), 'no_yield_piece_count', 'The recipe version states no yield piece count to divide by.'),
            ]);
        }

        $orderQuantity = $this->numeric($quantity);
        $pieceCountString = $this->numeric((string) $pieceCount);
        $portionFactor = $this->numeric((string) $meal->portion_factor);
        $wasteFactor = $this->wasteFactor((string) $version->waste_coefficient_percent);

        $lines = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->get();

        /** @var Collection<int, Collection<int, RecipeVersionLine>> $byIngredient */
        $byIngredient = $lines->groupBy('ingredient_id');

        /** @var list<ExplodedIngredient> $rows */
        $rows = [];

        /** @var list<ConsumptionFailure> $failures */
        $failures = [];

        foreach ($byIngredient as $ingredientId => $ingredientLines) {
            /** @var list<array{quantity: string|null, unit_id: string|null}> $measured */
            $measured = $ingredientLines->map(static fn (RecipeVersionLine $line): array => [
                'quantity' => $line->quantity === null ? null : (string) $line->quantity,
                'unit_id' => $line->unit_id,
            ])->values()->all();

            $this->explodeIngredient(
                $organisationId,
                (string) $meal->getKey(),
                $branchId,
                (string) $ingredientId,
                $measured,
                $pieceCountString,
                $portionFactor,
                $wasteFactor,
                $orderQuantity,
                $rows,
                $failures,
            );
        }

        $this->explodePackaging(
            $organisationId,
            (string) $meal->getKey(),
            $branchId,
            $version,
            $pieceCountString,
            $portionFactor,
            $orderQuantity,
            $rows,
            $failures,
        );

        return new MealExplosionResult($rows, $failures);
    }

    /**
     * What `$batchFactor` whole batches of a recipe version take off the shelf (PROD1).
     *
     * ## The same arithmetic, with two of its divisors set to one
     *
     * A sale asks "how much for one sold unit, times how many were ordered", so it divides by the
     * yield piece count and multiplies by the item's portion factor. A batch asks "how much for the
     * whole recipe, times how many times over", which is that question with the piece count and the
     * portion factor both at `1` and the batch factor standing in for the order quantity. Running it
     * through {@see explodeIngredient()} rather than beside it is the point: two implementations of
     * "how much flour" would drift on exactly the recipes that are hardest to reason about, and the
     * plan a kitchen reserves against would stop matching what a sale of the same recipe deducts.
     *
     * So the grouping, the round-once-per-unit-group conversion, the waste multiplier and every
     * refusal are the sale path's, unchanged.
     *
     * ## Two lists, because a production order stores two kinds of line
     *
     * A sale deducts ingredients and packaging together and values both as cost of goods. A batch
     * does not: the cook reports what actually went into the pot and what was thrown away, while
     * packaging is taken as planned. `line_kind` is how the order records that, so the explosion
     * hands back the two halves already separated rather than making the caller re-derive which row
     * was a box.
     *
     * ## Packaging rounds up; ingredients do not
     *
     * `recipe_version_packaging.quantity` is already per batch with its own ceiling applied — six
     * 0.3 kg bottles for a 1.7 kg yield — so whole batches need no further rounding. A **fractional**
     * batch does: 0.4 of a six-bottle recipe is 2.4 bottles, and a plan that asked for 2.4 would have
     * a cook take two and run out. Counted and packaged units therefore ceil, in decimal rather than
     * through a float, for the reason `RecipeVersionService` gives: 1.7 ÷ 0.1 is exactly 17 in
     * decimal and 16.999999999999996 in IEEE 754. Mass and volume packaging — brine filling bottles,
     * cling film by the metre — stays exact, because those genuinely divide.
     *
     * Ingredients never ceil. A fraction of a countable ingredient is a real instruction: 0.4 of an
     * egg is what a cook beating two and using part of them weighs out, and rounding it up would
     * silently change the recipe's proportions.
     *
     * ## No catalogue item, and therefore no `catalogue_item_id` on a failure
     *
     * A batch is a recipe being made, not a thing being sold, and the version may have no catalogue
     * item at all — an intermediate dressing is exactly that case. Failures carry a null subject
     * rather than a borrowed one.
     *
     * @param  string  $batchFactor  how many times over the recipe is being made; a non-numeric value is a loud failure, never a free deduction
     */
    public function explodeBatch(
        string $organisationId,
        RecipeVersion $version,
        string $batchFactor,
        ?string $branchId,
    ): BatchExplosionResult {
        $factor = $this->numeric($batchFactor);

        if (bccomp($factor, '0', self::SCALE) <= 0) {
            // Nothing is being made, so nothing is needed. Not a failure: a plan
            // for zero batches is a legible answer, and refusing it would make
            // the planning screen's empty state an error state.
            return new BatchExplosionResult;
        }

        $wasteFactor = $this->wasteFactor((string) $version->waste_coefficient_percent);

        $lines = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->get();

        /** @var Collection<int, Collection<int, RecipeVersionLine>> $byIngredient */
        $byIngredient = $lines->groupBy('ingredient_id');

        /** @var list<ExplodedIngredient> $ingredients */
        $ingredients = [];

        /** @var list<ConsumptionFailure> $failures */
        $failures = [];

        foreach ($byIngredient as $ingredientId => $ingredientLines) {
            /** @var list<array{quantity: string|null, unit_id: string|null}> $measured */
            $measured = $ingredientLines->map(static fn (RecipeVersionLine $line): array => [
                'quantity' => $line->quantity === null ? null : (string) $line->quantity,
                'unit_id' => $line->unit_id,
            ])->values()->all();

            $this->explodeIngredient(
                $organisationId,
                null,
                $branchId,
                (string) $ingredientId,
                $measured,
                '1',
                '1',
                $wasteFactor,
                $factor,
                $ingredients,
                $failures,
            );
        }

        /** @var list<ExplodedIngredient> $packaging */
        $packaging = [];

        $this->explodePackaging(
            $organisationId,
            null,
            $branchId,
            $version,
            '1',
            '1',
            $factor,
            $packaging,
            $failures,
            ceilCountable: true,
        );

        return new BatchExplosionResult($ingredients, $packaging, $failures);
    }

    /**
     * The consumables one sold unit takes off the shelf, appended to the same rows the formulation
     * produced.
     *
     * ## Why packaging belongs in the explosion at all
     *
     * A box is an `Ingredient` filed under `packaging-disposables`, so
     * {@see StockItemDerivationService} already gives it a shelf, in the unit the packaging row
     * itself stores. Every row this appends has the shape `explodeIngredient` produces, so
     * {@see OrderConsumptionService}, {@see RequirementForecast} and the COGS valuation need no
     * change: they sum rows, and there are simply more of them. A buy list will start including
     * boxes and a month's cost of goods will start including what they cost — both intended, and
     * both a step at the month this lands, which the cost report should say rather than imply.
     *
     * ## The arithmetic is the formulation's, with one column swapped
     *
     * `recipe_version_packaging.quantity` is per *batch* and already carries its `ceil`:
     * `RecipeVersionService::preparePackaging()` computed six bottles for a 1.7 kg yield before the
     * row was stored. So the per-sold-unit chain is the same one the ingredients take — ÷ piece
     * count × portion factor × order quantity — and a batch that fills six bottles across twelve
     * portions draws half a bottle per portion. Fractional, and correct: over the whole batch it
     * sums to exactly six, `stock_levels.quantity` is `decimal(14,4)`, and rounding each sale up to
     * a whole bottle would consume twelve.
     *
     * `fills_yield` makes that read naturally for the common case — a box whose capacity is one
     * portion gives `ceil(yield ÷ capacity) = piece count`, so exactly one box leaves per portion.
     * `per_batch` is the one that looks odd on a shelf: a shipping carton consumed once per run
     * amortises across the run. That is right for cost of goods and strange to look at, and it is
     * the basis's own meaning rather than anything this method decides.
     *
     * ## Waste is the packaging coefficient, not the production one
     *
     * `packaging_waste_percent`, which is a separate column for a reason the schema states: process
     * loss is sauce left in the pot, packaging loss is mis-fed labels and split film, and they are
     * different numbers. It defaults to `0.00`, so a version nobody has thought about deducts
     * exactly what its lines say.
     *
     * @param  string|null  $subjectId  the catalogue item a failure is attributed to, or null for a production batch
     * @param  numeric-string  $pieceCount
     * @param  numeric-string  $portionFactor
     * @param  numeric-string  $orderQuantity
     * @param  list<ExplodedIngredient>  $rows
     * @param  list<ConsumptionFailure>  $failures
     * @param  bool  $ceilCountable  see {@see explodeIngredient()} — true only on the batch path
     */
    private function explodePackaging(
        string $organisationId,
        ?string $subjectId,
        ?string $branchId,
        RecipeVersion $version,
        string $pieceCount,
        string $portionFactor,
        string $orderQuantity,
        array &$rows,
        array &$failures,
        bool $ceilCountable = false,
    ): void {
        $packaging = RecipeVersionPackaging::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->get();

        if ($packaging->isEmpty()) {
            return;
        }

        $wasteFactor = $this->wasteFactor((string) $version->packaging_waste_percent);

        /** @var Collection<int, Collection<int, RecipeVersionPackaging>> $byIngredient */
        $byIngredient = $packaging->groupBy('ingredient_id');

        foreach ($byIngredient as $ingredientId => $packagingLines) {
            /*
             * Grouped, because one version may name the same consumable twice — the same sticker on
             * the lid and on the sleeve is two lines, exactly as a formulation may reach for olive
             * oil in the marinade and again at the finish.
             */
            /** @var list<array{quantity: string|null, unit_id: string|null}> $measured */
            $measured = $packagingLines->map(static fn (RecipeVersionPackaging $line): array => [
                // Never null on this table: two of the three bases compute a quantity and the third
                // requires one. Typed nullable only because it shares `explodeIngredient`.
                'quantity' => (string) $line->quantity,
                'unit_id' => $line->unit_id,
            ])->values()->all();

            $this->explodeIngredient(
                $organisationId,
                $subjectId,
                $branchId,
                (string) $ingredientId,
                $measured,
                $pieceCount,
                $portionFactor,
                $wasteFactor,
                $orderQuantity,
                $rows,
                $failures,
                $ceilCountable,
            );
        }
    }

    /**
     * `1 + percent/100`, at working scale — the multiplier both waste columns become.
     *
     * @return numeric-string
     */
    private function wasteFactor(string $percent): string
    {
        return bcadd('1', bcdiv($this->numeric($percent), '100', self::WORKING_SCALE), self::WORKING_SCALE);
    }

    /**
     * The branch stock item for an ingredient. When more than one stock item is
     * linked to the ingredient, the one that already has a level at this branch
     * wins; otherwise the first by code — a deterministic pick rather than a
     * guess between equals.
     *
     * Public because the resold-product path in {@see OrderConsumptionService}
     * resolves its shelf the same way: one ingredient, one rule, whether it is
     * cooked into a meal or sold as it was bought.
     */
    public function resolveStockItem(string $organisationId, string $ingredientId, ?string $branchId): ?StockItem
    {
        $items = StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('ingredient_id', $ingredientId)
            ->orderBy('code')
            ->get();

        if ($items->isEmpty()) {
            return null;
        }

        if ($items->count() === 1) {
            return $items->first();
        }

        if ($branchId === null) {
            // Nothing to break the tie against, so the deterministic first by
            // code stands rather than an arbitrary one.
            return $items->first();
        }

        $withLevel = $items->first(static fn (StockItem $stockItem): bool => StockLevel::withoutTenancy()
            ->where('branch_id', $branchId)
            ->where('stock_item_id', $stockItem->getKey())
            ->exists());

        return $withLevel ?? $items->first();
    }

    /**
     * One ingredient of the recipe, from its lines to a quantity in the stock
     * item's own unit. Appends exactly one row, or exactly one failure, or —
     * when the arithmetic lands on zero — neither.
     *
     * Takes measured tuples rather than models because both halves of an explosion arrive here: the
     * formulation's `recipe_version_lines` and the packaging's `recipe_version_packaging`. They are
     * different tables carrying the same three facts, and the careful part — grouping by unit so
     * same-unit lines sum before any rounding, converting once per group, then dividing by the piece
     * count — is worth having in one place rather than two that must agree.
     *
     * @param  string|null  $subjectId  the catalogue item a failure is attributed to, or null when the subject is a production batch rather than a sale
     * @param  list<array{quantity: string|null, unit_id: string|null}>  $measured
     * @param  numeric-string  $pieceCount
     * @param  numeric-string  $portionFactor
     * @param  numeric-string  $wasteFactor
     * @param  numeric-string  $orderQuantity
     * @param  list<ExplodedIngredient>  $rows
     * @param  list<ConsumptionFailure>  $failures
     * @param  bool  $ceilCountable  round the answer **up** when the shelf counts in whole things — the batch planner's rule for packaging, never the sale path's
     */
    private function explodeIngredient(
        string $organisationId,
        ?string $subjectId,
        ?string $branchId,
        string $ingredientId,
        array $measured,
        string $pieceCount,
        string $portionFactor,
        string $wasteFactor,
        string $orderQuantity,
        array &$rows,
        array &$failures,
        bool $ceilCountable = false,
    ): void {
        $stockItem = $this->resolveStockItem($organisationId, $ingredientId, $branchId);

        if (! $stockItem instanceof StockItem) {
            $failures[] = $this->failure($subjectId, 'no_stock_item', 'Ingredient '.$ingredientId.' has no stock item at the branch to deduct from.');

            return;
        }

        if ($stockItem->unit_id === null) {
            $failures[] = $this->failure($subjectId, 'no_stock_unit', 'Stock item '.$stockItem->getKey().' has no resolved unit to convert into.');

            return;
        }

        $stockUnit = MeasurementUnit::query()->find($stockItem->unit_id);

        if (! $stockUnit instanceof MeasurementUnit) {
            $failures[] = $this->failure($subjectId, 'no_stock_unit', 'Stock item '.$stockItem->getKey().' points at a unit that does not exist.');

            return;
        }

        // Sum the duplicate lines grouped by their own unit, then convert each
        // group into the stock unit — so same-unit lines sum before any rounding
        // (the common case) and mixed-unit lines still total correctly.
        $byUnit = [];

        foreach ($measured as $line) {
            if ($line['quantity'] === null || $line['unit_id'] === null) {
                // A published recipe should carry quantities; an unquantified
                // line is unresolvable, so the ingredient is skipped rather than
                // summed as if the missing line were zero.
                $failures[] = $this->failure($subjectId, 'unquantified_recipe_line', 'A recipe line for ingredient '.$ingredientId.' has no quantity or unit.');

                return;
            }

            $byUnit[$line['unit_id']] = bcadd($byUnit[$line['unit_id']] ?? '0', $this->numeric($line['quantity']), self::WORKING_SCALE);
        }

        $totalInStockUnit = '0';

        foreach ($byUnit as $unitId => $summedQuantity) {
            $lineUnit = MeasurementUnit::query()->find($unitId);

            if (! $lineUnit instanceof MeasurementUnit) {
                $failures[] = $this->failure($subjectId, 'no_stock_unit', 'A recipe line for ingredient '.$ingredientId.' points at a unit that does not exist.');

                return;
            }

            try {
                $converted = $this->conversion->convert($this->round($summedQuantity), $lineUnit, $stockUnit);
            } catch (UnitConversionUnsupported $exception) {
                $failures[] = $this->failure($subjectId, 'unit_conversion_unsupported', 'Ingredient '.$ingredientId.': '.$exception->getMessage());

                return;
            }

            $totalInStockUnit = bcadd($totalInStockUnit, $converted, self::WORKING_SCALE);
        }

        // per sold unit = Σ line quantities ÷ yield piece count × the item's
        // portion factor; × waste factor; × the number of this meal on the
        // order. One sold unit = one yield piece × the item's portion factor —
        // half a portion of the same recipe takes half the ingredients.
        $perSoldUnit = bcmul(
            bcdiv($totalInStockUnit, $pieceCount, self::WORKING_SCALE),
            $portionFactor,
            self::WORKING_SCALE,
        );
        $withWaste = bcmul($perSoldUnit, $wasteFactor, self::WORKING_SCALE);
        $consumed = $this->round(bcmul($withWaste, $orderQuantity, self::WORKING_SCALE));

        if ($ceilCountable && in_array($stockUnit->dimension, ['count', 'package'], true)) {
            $consumed = $this->ceilWhole($consumed);
        }

        if (bccomp($consumed, '0', self::SCALE) <= 0) {
            return;
        }

        $rows[] = [
            'stock_item_id' => (string) $stockItem->getKey(),
            'stock_unit_id' => (string) $stockUnit->getKey(),
            'ingredient_id' => $ingredientId,
            'quantity' => $consumed,
        ];
    }

    /**
     * @return ConsumptionFailure
     */
    private function failure(?string $catalogueItemId, string $reasonCode, string $detail): array
    {
        return [
            'catalogue_item_id' => $catalogueItemId,
            'reason_code' => $reasonCode,
            'detail' => $detail,
        ];
    }

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring, so a
     * malformed quantity would silently make a deduction free. This turns that
     * into a loud failure instead.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Meal explosion arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }

    /**
     * The next whole number at or above `$value`, in decimal.
     *
     * `bcdiv` by one truncates, so the ceiling is that quotient plus one whenever
     * anything was truncated. Done this way rather than by casting to float and
     * calling `ceil()`, for the reason `RecipeVersionService::containersFor()`
     * gives: a quantity that is exactly 17 in decimal is 16.999999999999996 in
     * IEEE 754, and the float route would quietly bill an eighteenth container.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function ceilWhole(string $value): string
    {
        $whole = bcdiv($value, '1', 0);

        return bccomp($whole, $value, self::SCALE) === 0
            ? $whole
            : bcadd($whole, '1', 0);
    }

    /**
     * Round half away from zero to the six places the stock and cost columns
     * store — the one rounding rule shared across the money-and-stock
     * arithmetic.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-'.$half : $half, self::SCALE);
    }
}
