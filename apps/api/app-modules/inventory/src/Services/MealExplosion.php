<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
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
 * ingredient, divide by the yield piece count for a per-sold-unit quantity,
 * apply the waste coefficient as a per-unit multiplier, multiply by the number
 * ordered — each ingredient converted into its branch stock item's unit. What
 * this class does *not* do is write: it hands back quantities and refusals, and
 * the caller decides whether that means a stock movement (a confirmed order) or
 * a number on a report (a requirement forecast).
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
        $wasteFactor = bcadd('1', bcdiv($this->numeric((string) $version->waste_coefficient_percent), '100', self::WORKING_SCALE), self::WORKING_SCALE);

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
            $this->explodeIngredient(
                $organisationId,
                $meal,
                $branchId,
                (string) $ingredientId,
                $ingredientLines,
                (string) $pieceCount,
                $wasteFactor,
                $orderQuantity,
                $rows,
                $failures,
            );
        }

        return new MealExplosionResult($rows, $failures);
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
     * @param  Collection<int, RecipeVersionLine>  $ingredientLines
     * @param  numeric-string  $pieceCount
     * @param  numeric-string  $wasteFactor
     * @param  numeric-string  $orderQuantity
     * @param  list<ExplodedIngredient>  $rows
     * @param  list<ConsumptionFailure>  $failures
     */
    private function explodeIngredient(
        string $organisationId,
        CatalogueItem $meal,
        ?string $branchId,
        string $ingredientId,
        Collection $ingredientLines,
        string $pieceCount,
        string $wasteFactor,
        string $orderQuantity,
        array &$rows,
        array &$failures,
    ): void {
        $stockItem = $this->resolveStockItem($organisationId, $ingredientId, $branchId);

        if (! $stockItem instanceof StockItem) {
            $failures[] = $this->failure((string) $meal->getKey(), 'no_stock_item', 'Ingredient '.$ingredientId.' has no stock item at the branch to deduct from.');

            return;
        }

        if ($stockItem->unit_id === null) {
            $failures[] = $this->failure((string) $meal->getKey(), 'no_stock_unit', 'Stock item '.$stockItem->getKey().' has no resolved unit to convert into.');

            return;
        }

        $stockUnit = MeasurementUnit::query()->find($stockItem->unit_id);

        if (! $stockUnit instanceof MeasurementUnit) {
            $failures[] = $this->failure((string) $meal->getKey(), 'no_stock_unit', 'Stock item '.$stockItem->getKey().' points at a unit that does not exist.');

            return;
        }

        // Sum the duplicate lines grouped by their own unit, then convert each
        // group into the stock unit — so same-unit lines sum before any rounding
        // (the common case) and mixed-unit lines still total correctly.
        $byUnit = [];

        foreach ($ingredientLines as $recipeLine) {
            if ($recipeLine->quantity === null || $recipeLine->unit_id === null) {
                // A published recipe should carry quantities; an unquantified
                // line is unresolvable, so the ingredient is skipped rather than
                // summed as if the missing line were zero.
                $failures[] = $this->failure((string) $meal->getKey(), 'unquantified_recipe_line', 'A recipe line for ingredient '.$ingredientId.' has no quantity or unit.');

                return;
            }

            $byUnit[$recipeLine->unit_id] = bcadd($byUnit[$recipeLine->unit_id] ?? '0', $this->numeric((string) $recipeLine->quantity), self::WORKING_SCALE);
        }

        $totalInStockUnit = '0';

        foreach ($byUnit as $unitId => $summedQuantity) {
            $lineUnit = MeasurementUnit::query()->find($unitId);

            if (! $lineUnit instanceof MeasurementUnit) {
                $failures[] = $this->failure((string) $meal->getKey(), 'no_stock_unit', 'A recipe line for ingredient '.$ingredientId.' points at a unit that does not exist.');

                return;
            }

            try {
                $converted = $this->conversion->convert($this->round($summedQuantity), $lineUnit, $stockUnit);
            } catch (UnitConversionUnsupported $exception) {
                $failures[] = $this->failure((string) $meal->getKey(), 'unit_conversion_unsupported', 'Ingredient '.$ingredientId.': '.$exception->getMessage());

                return;
            }

            $totalInStockUnit = bcadd($totalInStockUnit, $converted, self::WORKING_SCALE);
        }

        // per sold unit = Σ line quantities ÷ yield piece count; × waste factor;
        // × the number of this meal on the order.
        $perSoldUnit = bcdiv($totalInStockUnit, $pieceCount, self::WORKING_SCALE);
        $withWaste = bcmul($perSoldUnit, $wasteFactor, self::WORKING_SCALE);
        $consumed = $this->round(bcmul($withWaste, $orderQuantity, self::WORKING_SCALE));

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
