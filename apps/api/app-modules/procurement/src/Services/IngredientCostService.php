<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Procurement\Exceptions\MixedIngredientCostCurrency;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use RuntimeException;

/**
 * The weighted moving-average cost of an ingredient, blended one purchase at a
 * time (INV1.1).
 *
 * The same discipline the recipe costing layer runs on
 * (`RecipeCostingService`), for the same reason: this is money.
 *
 * 1. **Strings and bcmath, never floats.** Every amount is a major-unit decimal
 *    with six places (§4.4). Intermediate arithmetic runs at twelve and is
 *    rounded half away from zero to six exactly once per stored figure. A cost
 *    that changed when `0.1 + 0.2` was evaluated is not a cost.
 * 2. **One currency, no conversion.** The average carries one currency; a
 *    purchase in another is refused (`MixedIngredientCostCurrency`), never
 *    reconciled at an invented rate.
 * 3. **One unit, resolved from the ingredient.** The average is expressed per
 *    the ingredient's `default_unit_id`, so a purchase in grams and one in
 *    kilograms blend into one figure. The purchased quantity is converted into
 *    that unit through `UnitConversionService`, which refuses loudly across
 *    dimensions (`unit.conversion_unsupported`) rather than inventing a
 *    density.
 *
 * The blend is the textbook perpetual weighted average:
 *
 *     new_average = (old_qty · old_average + recv_qty · recv_unit_cost)
 *                   ÷ (old_qty + recv_qty)
 *
 * where every quantity is in the ingredient's default unit. A receipt raises
 * `quantity_on_hand`; INV1.2's consume path lowers it while reading the average
 * for COGS, so the basis stays a true perpetual average rather than a
 * purchases-only running mean.
 */
final class IngredientCostService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(private readonly UnitConversionService $conversion) {}

    /**
     * Blend one priced purchase into an ingredient's moving-average cost, and
     * append the event that records it.
     *
     * Runs inside the caller's transaction — `GoodsReceiptService` posts the
     * stock movement and the cost blend as one unit — and takes a row lock on
     * the current-value row so two concurrent receipts of the same ingredient
     * serialise rather than losing each other's quantity.
     *
     * @param  numeric-string  $purchasedQuantity  received quantity, in $purchaseUnit
     * @param  numeric-string  $unitPriceAmount  price per $purchaseUnit, major currency units
     *
     * @throws MixedIngredientCostCurrency when the purchase currency differs from the ingredient's held cost
     * @throws UnitConversionUnsupported when the purchase unit cannot convert to the ingredient's default unit
     */
    public function recordPurchase(
        string $organisationId,
        Ingredient $ingredient,
        string $purchasedQuantity,
        MeasurementUnit $purchaseUnit,
        string $unitPriceAmount,
        string $currencyCode,
        ?string $sourceReceiptLineId = null,
    ): IngredientStockCost {
        $quantity = $this->numeric($purchasedQuantity);
        $unitPrice = $this->numeric($unitPriceAmount);

        /** @var MeasurementUnit $ingredientUnit */
        $ingredientUnit = $ingredient->defaultUnit()->firstOrFail();

        // The received quantity in the ingredient's own unit — this is the
        // weight the average is blended over. A cross-dimension purchase unit
        // is refused here, not silently valued.
        $receivedQuantity = $this->conversion->convert($quantity, $purchaseUnit, $ingredientUnit);

        if (bccomp($receivedQuantity, '0', self::SCALE) <= 0) {
            throw new RuntimeException('A purchase converted to a non-positive quantity in the ingredient unit.');
        }

        // What was actually paid, currency-side: quantity × price is unit-free,
        // so it is computed once from the purchase figures and then expressed
        // per ingredient unit.
        $lineTotal = $this->round(bcmul($quantity, $unitPrice, self::WORKING_SCALE));
        $receivedUnitCost = $this->round(bcdiv($lineTotal, $receivedQuantity, self::WORKING_SCALE));

        $cost = IngredientStockCost::query()
            ->where('organisation_id', $organisationId)
            ->where('ingredient_id', $ingredient->getKey())
            ->lockForUpdate()
            ->first();

        if ($cost === null) {
            $cost = new IngredientStockCost;
            $cost->organisation_id = $organisationId;
            $cost->ingredient_id = (string) $ingredient->getKey();
            $cost->unit_id = (string) $ingredientUnit->getKey();
            $cost->quantity_on_hand = '0';
            $cost->currency_code = null;
        }

        if ($cost->currency_code !== null && $cost->currency_code !== $currencyCode) {
            throw new MixedIngredientCostCurrency($cost->currency_code, $currencyCode, (string) $ingredient->getKey());
        }

        $oldQuantity = $this->numeric((string) $cost->quantity_on_hand);
        $oldAverage = $cost->moving_average_cost_amount === null
            ? '0'
            : $this->numeric((string) $cost->moving_average_cost_amount);

        $newQuantity = bcadd($oldQuantity, $receivedQuantity, self::WORKING_SCALE);

        // (old_qty·old_avg + recv_qty·recv_cost) ÷ new_qty, using the *stored*
        // received unit cost so a reader recomputing the average from the ledger
        // row gets exactly this figure back.
        $weightedNumerator = bcadd(
            bcmul($oldQuantity, $oldAverage, self::WORKING_SCALE),
            bcmul($receivedQuantity, $receivedUnitCost, self::WORKING_SCALE),
            self::WORKING_SCALE,
        );

        $newAverage = bccomp($newQuantity, '0', self::WORKING_SCALE) > 0
            ? $this->round(bcdiv($weightedNumerator, $newQuantity, self::WORKING_SCALE))
            : $receivedUnitCost;

        $newQuantityStored = $this->round($newQuantity);

        $cost->quantity_on_hand = $newQuantityStored;
        $cost->moving_average_cost_amount = $newAverage;
        $cost->last_purchase_cost_amount = $receivedUnitCost;
        $cost->currency_code = $currencyCode;
        $cost->unit_id = (string) $ingredientUnit->getKey();
        $cost->save();

        $event = new IngredientCostEvent;
        $event->organisation_id = $organisationId;
        $event->ingredient_id = (string) $ingredient->getKey();
        $event->source_receipt_line_id = $sourceReceiptLineId;
        $event->unit_id = (string) $ingredientUnit->getKey();
        $event->quantity = $receivedQuantity;
        $event->unit_cost_amount = $receivedUnitCost;
        $event->line_total_amount = $lineTotal;
        $event->currency_code = $currencyCode;
        $event->resulting_average_amount = $newAverage;
        $event->resulting_quantity = $newQuantityStored;
        $event->save();

        return $cost;
    }

    /**
     * Round half away from zero to the six places the cost columns store.
     * Copied deliberately from `RecipeCostingService`: one rounding rule across
     * the money-and-stock arithmetic is one fewer place for two answers to
     * disagree.
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

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring, so
     * a malformed amount would silently make an ingredient free. This turns that
     * into a loud failure instead.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Ingredient cost arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
