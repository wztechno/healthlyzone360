<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Orders\Contracts\OrderStockConsumption;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * The real answer to Orders' `OrderStockConsumption` port: a confirmed order
 * takes ingredients off the shelf, a cancelled one puts them back, and every
 * deduction carries the COGS it cost the kitchen (INV1.2).
 *
 * The whole slice's correctness lives here, so five rules run through all of it.
 *
 * 1. **bcmath, never floats.** Quantities are divided by a yield and multiplied
 *    by a waste factor and an order quantity and then converted across units;
 *    a float would drift a real balance over a real month. Intermediate steps
 *    run at twelve places and round half away from zero to six exactly once per
 *    stored figure, the same discipline as `RecipeCostingService` and
 *    `IngredientCostService`.
 * 2. **Never fabricate a quantity.** Every branch that cannot resolve a real
 *    number — no published recipe version, no piece count, an unquantified line,
 *    no branch stock item, no convertible unit — deducts nothing for that
 *    ingredient and writes an {@see OrderConsumptionException}. A confirmed
 *    order is not blocked and a made-up number never reaches the ledger.
 * 3. **A confirmed order does not hard-fail on stock math.** Even
 *    `InsufficientStock` is recorded as an exception and the confirm continues:
 *    the kitchen has already committed to cook, and a negative shelf is a
 *    counting problem to surface, not a reason to refuse an order the customer
 *    is waiting on. (This is the one judgement call the plan left open; it is
 *    resolved toward "record and continue" for exactly that reason.)
 * 4. **COGS reads the moving average, and lowers the basis without rewriting
 *    it.** The consume movement is valued at `ingredient_stock_costs.moving_
 *    average_cost_amount`, and the consumed quantity is decremented from
 *    `quantity_on_hand` so the perpetual average stays honest — the average
 *    itself is never touched on a consume, only on a purchase.
 * 5. **Idempotent both ways.** Consuming an order whose movements already exist,
 *    or restoring one already restored, is a no-op — a lost-update retry or a
 *    redelivered event cannot double-count.
 *
 * All reads are `withoutTenancy()` scoped explicitly to the order's seller
 * organisation: consumption runs on the kitchen's own confirm, but a
 * subscription-generated order can flow through a job whose ambient tenant is
 * not the seller, and a deduction that depended on request context would be a
 * deduction that sometimes silently found nothing.
 */
final readonly class OrderConsumptionService implements OrderStockConsumption
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /**
     * The reference_type stamped on a consume movement, so its cost and quantity
     * can be read back for the monthly report and for reversal.
     */
    private const string CONSUME_REFERENCE = 'order';

    /**
     * The reference_type stamped on a reversal movement — distinct from the
     * consume reference so restoring twice is a cheap existence check.
     */
    private const string REVERSAL_REFERENCE = 'order_reversal';

    public function __construct(
        private InventoryService $inventory,
        private UnitConversionService $conversion,
        private DerivedAllergenService $allergens,
    ) {}

    public function consume(Order $order): void
    {
        // Never deduct twice for one order — the guard the port promises.
        if ($this->hasConsumed($order)) {
            return;
        }

        if ($order->branch_id === null) {
            // Stock is a per-branch quantity; an order with no branch has no
            // shelf to take from. Recorded rather than guessed.
            $this->recordException($order, null, null, 'no_branch', 'The order has no branch, so no stock could be deducted.');

            return;
        }

        foreach ($order->lines()->get() as $line) {
            $this->consumeLine($order, $line, $order->branch_id);
        }
    }

    public function restore(Order $order): void
    {
        if ($this->hasRestored($order)) {
            return;
        }

        $movements = StockMovement::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('reference_type', self::CONSUME_REFERENCE)
            ->where('reference_id', (string) $order->getKey())
            ->where('reason', 'consume')
            ->get();

        foreach ($movements as $movement) {
            // The consume stored a negative delta; the reversal adds back its
            // magnitude, exactly what was removed.
            $addBack = bcmul($this->numeric((string) $movement->quantity_delta), '-1', self::SCALE);

            if (bccomp($addBack, '0', self::SCALE) <= 0) {
                continue;
            }

            $this->inventory->recordMovement(
                (string) $order->organisation_id,
                (string) $movement->branch_id,
                (string) $movement->stock_item_id,
                'adjust',
                $addBack,
                self::REVERSAL_REFERENCE,
                (string) $order->getKey(),
                notes: 'Reversal of consume '.$movement->getKey().' on order cancellation.',
            );

            $this->restoreQuantityOnHand($order, $movement, $addBack);
        }
    }

    private function consumeLine(Order $order, OrderLine $line, string $branchId): void
    {
        $item = CatalogueItem::withoutTenancy()
            ->where('id', $line->catalogue_item_id)
            ->where('organisation_id', $order->organisation_id)
            ->first();

        if (! $item instanceof CatalogueItem) {
            $this->recordException($order, $line, $line->catalogue_item_id, 'no_catalogue_item', 'The order line references no catalogue item in this organisation.');

            return;
        }

        match ($item->item_type) {
            CatalogueItemType::Meal => $this->consumeMeal($order, $line, $item, $branchId),
            CatalogueItemType::Product => $this->consumeProduct($order, $line, $item, $branchId),

            // The zero-food plan-day line consumes nothing: the real meal and
            // product lines generated alongside it do the consuming.
            CatalogueItemType::SubscriptionPlan => null,
        };
    }

    /**
     * A meal explodes into its published recipe: sum the version's lines per
     * ingredient, divide by the yield piece count for a per-sold-unit quantity,
     * apply the waste coefficient as a per-unit multiplier, multiply by the
     * order line quantity, then deduct — each ingredient converted into its
     * branch stock item's unit.
     */
    private function consumeMeal(Order $order, OrderLine $line, CatalogueItem $item, string $branchId): void
    {
        $version = $this->allergens->publishedVersion($item);

        if (! $version instanceof RecipeVersion) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_recipe_version', 'The meal links no published recipe version to explode into ingredients.');

            return;
        }

        $pieceCount = $version->yield_piece_count;

        if ($pieceCount === null || $pieceCount <= 0) {
            // Without a divisor there is no "per sold unit" — the exact blocker
            // the plan calls out. Recorded, never guessed as one.
            $this->recordException($order, $line, (string) $item->getKey(), 'no_yield_piece_count', 'The recipe version states no yield piece count to divide by.');

            return;
        }

        $orderQuantity = $this->numeric((string) $line->quantity);
        $wasteFactor = bcadd('1', bcdiv($this->numeric((string) $version->waste_coefficient_percent), '100', self::WORKING_SCALE), self::WORKING_SCALE);

        $lines = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->get();

        /** @var Collection<int, Collection<int, RecipeVersionLine>> $byIngredient */
        $byIngredient = $lines->groupBy('ingredient_id');

        foreach ($byIngredient as $ingredientId => $ingredientLines) {
            $this->consumeMealIngredient(
                $order,
                $line,
                $item,
                $branchId,
                (string) $ingredientId,
                $ingredientLines,
                (string) $pieceCount,
                $wasteFactor,
                $orderQuantity,
            );
        }
    }

    /**
     * @param  Collection<int, RecipeVersionLine>  $ingredientLines
     * @param  numeric-string  $pieceCount
     * @param  numeric-string  $wasteFactor
     * @param  numeric-string  $orderQuantity
     */
    private function consumeMealIngredient(
        Order $order,
        OrderLine $line,
        CatalogueItem $item,
        string $branchId,
        string $ingredientId,
        Collection $ingredientLines,
        string $pieceCount,
        string $wasteFactor,
        string $orderQuantity,
    ): void {
        $stockItem = $this->resolveStockItem((string) $order->organisation_id, $ingredientId, $branchId);

        if (! $stockItem instanceof StockItem) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_item', 'Ingredient '.$ingredientId.' has no stock item at the branch to deduct from.');

            return;
        }

        if ($stockItem->unit_id === null) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_unit', 'Stock item '.$stockItem->getKey().' has no resolved unit to convert into.');

            return;
        }

        $stockUnit = MeasurementUnit::query()->find($stockItem->unit_id);

        if (! $stockUnit instanceof MeasurementUnit) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_unit', 'Stock item '.$stockItem->getKey().' points at a unit that does not exist.');

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
                $this->recordException($order, $line, (string) $item->getKey(), 'unquantified_recipe_line', 'A recipe line for ingredient '.$ingredientId.' has no quantity or unit.');

                return;
            }

            $byUnit[$recipeLine->unit_id] = bcadd($byUnit[$recipeLine->unit_id] ?? '0', $this->numeric((string) $recipeLine->quantity), self::WORKING_SCALE);
        }

        $totalInStockUnit = '0';

        foreach ($byUnit as $unitId => $summedQuantity) {
            $lineUnit = MeasurementUnit::query()->find($unitId);

            if (! $lineUnit instanceof MeasurementUnit) {
                $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_unit', 'A recipe line for ingredient '.$ingredientId.' points at a unit that does not exist.');

                return;
            }

            try {
                $converted = $this->conversion->convert($this->round($summedQuantity), $lineUnit, $stockUnit);
            } catch (UnitConversionUnsupported $exception) {
                $this->recordException($order, $line, (string) $item->getKey(), 'unit_conversion_unsupported', 'Ingredient '.$ingredientId.': '.$exception->getMessage());

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

        $this->deduct($order, $line, $item, $branchId, $stockItem, $stockUnit, $ingredientId, $consumed);
    }

    /**
     * A resold product has no recipe: it deducts the order-line quantity of its
     * own stock item, one unit sold for one unit off the shelf, valued at the
     * product's own moving-average cost.
     */
    private function consumeProduct(Order $order, OrderLine $line, CatalogueItem $item, string $branchId): void
    {
        if ($item->ingredient_id === null) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_ingredient_link', 'The product links no ingredient, so it has no stock item to deduct.');

            return;
        }

        $stockItem = $this->resolveStockItem((string) $order->organisation_id, (string) $item->ingredient_id, $branchId);

        if (! $stockItem instanceof StockItem) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_item', 'The product has no stock item at the branch to deduct from.');

            return;
        }

        if ($stockItem->unit_id === null) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_unit', 'Stock item '.$stockItem->getKey().' has no resolved unit.');

            return;
        }

        $stockUnit = MeasurementUnit::query()->find($stockItem->unit_id);

        if (! $stockUnit instanceof MeasurementUnit) {
            $this->recordException($order, $line, (string) $item->getKey(), 'no_stock_unit', 'Stock item '.$stockItem->getKey().' points at a unit that does not exist.');

            return;
        }

        $consumed = $this->round($this->numeric((string) $line->quantity));

        if (bccomp($consumed, '0', self::SCALE) <= 0) {
            return;
        }

        $this->deduct($order, $line, $item, $branchId, $stockItem, $stockUnit, (string) $item->ingredient_id, $consumed);
    }

    /**
     * Record the consume movement and its COGS, and lower the moving-average
     * basis quantity. The single deduction path both item types reach.
     *
     * @param  numeric-string  $consumedInStockUnit
     */
    private function deduct(
        Order $order,
        OrderLine $line,
        CatalogueItem $item,
        string $branchId,
        StockItem $stockItem,
        MeasurementUnit $stockUnit,
        string $ingredientId,
        string $consumedInStockUnit,
    ): void {
        $cost = IngredientStockCost::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('ingredient_id', $ingredientId)
            ->first();

        $unitCostAmount = null;
        $costAmount = null;
        $currencyCode = null;
        $consumedInCostUnit = null;
        $costProblem = null;

        if ($cost instanceof IngredientStockCost && $cost->moving_average_cost_amount !== null && $cost->currency_code !== null) {
            $costUnit = MeasurementUnit::query()->find($cost->unit_id);

            if ($costUnit instanceof MeasurementUnit) {
                try {
                    $consumedInCostUnit = $this->conversion->convert($consumedInStockUnit, $stockUnit, $costUnit);
                    $unitCostAmount = $this->numeric((string) $cost->moving_average_cost_amount);
                    $costAmount = $this->round(bcmul($consumedInCostUnit, $unitCostAmount, self::WORKING_SCALE));
                    $currencyCode = $cost->currency_code;
                } catch (UnitConversionUnsupported $exception) {
                    // The stock deducts; the COGS side cannot be valued because
                    // the stock unit will not convert to the cost unit.
                    $consumedInCostUnit = null;
                    $costProblem = 'unit_conversion_unsupported';
                }
            } else {
                $costProblem = 'no_ingredient_cost';
            }
        } else {
            $costProblem = 'no_ingredient_cost';
        }

        try {
            $this->inventory->recordMovement(
                (string) $order->organisation_id,
                $branchId,
                (string) $stockItem->getKey(),
                'consume',
                '-'.$consumedInStockUnit,
                self::CONSUME_REFERENCE,
                (string) $order->getKey(),
                notes: 'Order line '.$line->getKey().' consumption.',
                unitCostAmount: $unitCostAmount,
                costAmount: $costAmount,
                costCurrencyCode: $currencyCode,
            );
        } catch (InsufficientStock $exception) {
            // A confirmed order does not hard-fail on stock math: the movement
            // is refused, nothing is deducted, and the shortfall is surfaced.
            $this->recordException($order, $line, (string) $item->getKey(), 'insufficient_stock', 'Ingredient '.$ingredientId.': not enough stock to deduct '.$consumedInStockUnit.'.');

            return;
        }

        if ($consumedInCostUnit !== null) {
            // COGS was valued: lower the perpetual basis without rewriting the
            // average (the average only moves on a purchase).
            $this->lowerQuantityOnHand((string) $cost->getKey(), $consumedInCostUnit);

            return;
        }

        if ($costProblem !== null) {
            // The stock came off the shelf, but its cost could not be valued —
            // an honest partial deduction, recorded so the report knows.
            $detail = $costProblem === 'unit_conversion_unsupported'
                ? 'Stock deducted, but its unit does not convert to the ingredient cost unit, so COGS is unvalued.'
                : 'Stock deducted, but no moving-average cost exists for ingredient '.$ingredientId.', so COGS is unvalued.';

            $this->recordException($order, $line, (string) $item->getKey(), $costProblem, $detail);
        }
    }

    /**
     * Decrement the moving-average basis quantity by what was consumed, under a
     * row lock. The average amount is untouched — a consume values COGS from it
     * but does not move it.
     *
     * @param  numeric-string  $consumedInCostUnit
     */
    private function lowerQuantityOnHand(string $costId, string $consumedInCostUnit): void
    {
        $cost = IngredientStockCost::withoutTenancy()
            ->whereKey($costId)
            ->lockForUpdate()
            ->first();

        if (! $cost instanceof IngredientStockCost) {
            return;
        }

        $cost->quantity_on_hand = bcsub($this->numeric((string) $cost->quantity_on_hand), $consumedInCostUnit, self::SCALE);
        $cost->save();
    }

    /**
     * Put back on the basis quantity exactly what a consume movement removed —
     * recomputed through the same conversion the consume used, so the reversal
     * is deterministic rather than an approximation of the original.
     *
     * @param  numeric-string  $addBackInStockUnit
     */
    private function restoreQuantityOnHand(Order $order, StockMovement $movement, string $addBackInStockUnit): void
    {
        $stockItem = StockItem::withoutTenancy()->whereKey($movement->stock_item_id)->first();

        if (! $stockItem instanceof StockItem || $stockItem->ingredient_id === null || $stockItem->unit_id === null) {
            return;
        }

        $cost = IngredientStockCost::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('ingredient_id', $stockItem->ingredient_id)
            ->lockForUpdate()
            ->first();

        if (! $cost instanceof IngredientStockCost) {
            return;
        }

        $stockUnit = MeasurementUnit::query()->find($stockItem->unit_id);
        $costUnit = MeasurementUnit::query()->find($cost->unit_id);

        if (! $stockUnit instanceof MeasurementUnit || ! $costUnit instanceof MeasurementUnit) {
            return;
        }

        try {
            $addBackInCostUnit = $this->conversion->convert($addBackInStockUnit, $stockUnit, $costUnit);
        } catch (UnitConversionUnsupported) {
            return;
        }

        $cost->quantity_on_hand = bcadd($this->numeric((string) $cost->quantity_on_hand), $addBackInCostUnit, self::SCALE);
        $cost->save();
    }

    /**
     * The branch stock item for an ingredient. When more than one stock item is
     * linked to the ingredient, the one that already has a level at this branch
     * wins; otherwise the first by code — a deterministic pick rather than a
     * guess between equals.
     */
    private function resolveStockItem(string $organisationId, string $ingredientId, string $branchId): ?StockItem
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

        $withLevel = $items->first(static fn (StockItem $stockItem): bool => StockLevel::withoutTenancy()
            ->where('branch_id', $branchId)
            ->where('stock_item_id', $stockItem->getKey())
            ->exists());

        return $withLevel ?? $items->first();
    }

    private function hasConsumed(Order $order): bool
    {
        return StockMovement::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('reference_type', self::CONSUME_REFERENCE)
            ->where('reference_id', (string) $order->getKey())
            ->where('reason', 'consume')
            ->exists();
    }

    private function hasRestored(Order $order): bool
    {
        return StockMovement::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('reference_type', self::REVERSAL_REFERENCE)
            ->where('reference_id', (string) $order->getKey())
            ->exists();
    }

    private function recordException(Order $order, ?OrderLine $line, ?string $catalogueItemId, string $reasonCode, string $detail): void
    {
        $exception = new OrderConsumptionException;
        $exception->organisation_id = (string) $order->organisation_id;
        $exception->order_id = (string) $order->getKey();
        $exception->order_line_id = $line === null ? null : (string) $line->getKey();
        $exception->catalogue_item_id = $catalogueItemId;
        $exception->reason_code = $reasonCode;
        $exception->detail = $detail;
        $exception->save();
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
            throw new RuntimeException("Order consumption arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }

    /**
     * Round half away from zero to the six places the stock and cost columns
     * store — the one rounding rule shared across the money-and-stock arithmetic.
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
