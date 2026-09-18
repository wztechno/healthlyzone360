<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientCostEvent;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Procurement\Exceptions\MixedIngredientCostCurrency;
use Healthy360\Procurement\Exceptions\StrandedIngredientCostUnit;
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
     * @throws StrandedIngredientCostUnit when the held balance's unit cannot be rebased onto the ingredient's current one
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
        return $this->blend(
            $organisationId,
            $ingredient,
            $purchasedQuantity,
            $purchaseUnit,
            $unitPriceAmount,
            $currencyCode,
            $sourceReceiptLineId,
            isPurchase: true,
        );
    }

    /**
     * Blend a finished production batch into the produced ingredient's
     * moving-average cost (PROD1).
     *
     * The same blend, and deliberately so: a kitchen that makes a litre of
     * dressing and a kitchen that buys one both end up with a litre on the shelf
     * worth what it cost to get there, and two different averages for the same
     * shelf would be two answers to what that litre is worth. `MealExplosion` and
     * the COGS valuation read one figure; there is one figure.
     *
     * **`last_purchase_cost_amount` is not touched.** That column answers "what
     * did we last *pay* for this", and a batch is not a payment. Writing a
     * production unit cost into it would make a supplier-price surface quote a
     * number no supplier ever quoted.
     *
     * The caller is expected to have posted the `yield` movement in the same
     * transaction, exactly as `GoodsReceiptService` posts its movement beside its
     * blend, and to call this **only** when the batch's cost is complete: blending
     * a partial total, or raising the quantity at a zero cost, silently dilutes
     * the average for every sale afterwards.
     *
     * @param  numeric-string  $producedQuantity  in $yieldUnit
     * @param  numeric-string  $unitCostAmount  the batch's cost per $yieldUnit
     *
     * @throws MixedIngredientCostCurrency when the batch currency differs from the ingredient's held cost
     * @throws StrandedIngredientCostUnit when the held balance's unit cannot be rebased onto the ingredient's current one
     * @throws UnitConversionUnsupported when the yield unit cannot convert to the ingredient's default unit
     */
    public function recordProducedBatch(
        string $organisationId,
        Ingredient $ingredient,
        string $producedQuantity,
        MeasurementUnit $yieldUnit,
        string $unitCostAmount,
        string $currencyCode,
    ): IngredientStockCost {
        return $this->blend(
            $organisationId,
            $ingredient,
            $producedQuantity,
            $yieldUnit,
            $unitCostAmount,
            $currencyCode,
            null,
            isPurchase: false,
        );
    }

    /**
     * The weighted blend itself, shared by the two ways stock arrives.
     *
     * @param  numeric-string  $purchasedQuantity
     * @param  numeric-string  $unitPriceAmount
     * @param  bool  $isPurchase  false for a production batch, which must not move `last_purchase_cost_amount`
     *
     * @throws MixedIngredientCostCurrency
     * @throws StrandedIngredientCostUnit
     * @throws UnitConversionUnsupported
     */
    private function blend(
        string $organisationId,
        Ingredient $ingredient,
        string $purchasedQuantity,
        MeasurementUnit $purchaseUnit,
        string $unitPriceAmount,
        string $currencyCode,
        ?string $sourceReceiptLineId,
        bool $isPurchase,
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

        /*
         * The held balance and the incoming receipt must be in the same unit before either is
         * blended into the other.
         *
         * `quantity_on_hand` and `moving_average_cost_amount` are denominated in `$cost->unit_id`,
         * which is whatever the ingredient's default unit was when the row was last written. That
         * unit can move underneath the balance — an operator re-denominating a row, or a migration
         * normalising the library — and when it does, `$receivedQuantity` above is in the *new*
         * unit while `$oldQuantity` is still in the old one.
         *
         * This used to be unchecked, and the failure was silent in the worst way: the two were
         * summed, the average was weighted across both, and `$cost->unit_id` was then overwritten
         * with the new unit at the end of the method — relabelling the evidence so no reader could
         * afterwards tell that a count of pieces had been added to a weight in kilograms.
         */
        [$oldQuantity, $oldAverage] = $this->rebaseHeldBalance($cost, $ingredient, $ingredientUnit, $oldQuantity, $oldAverage);

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

        if ($isPurchase) {
            // "What did we last pay for this" — a question a production batch is
            // not an answer to.
            $cost->last_purchase_cost_amount = $receivedUnitCost;
        }

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
     * The held balance, expressed in the unit the ingredient stocks in today.
     *
     * Three outcomes, and the middle one is the whole point of the method:
     *
     * 1. **Same unit** — the overwhelmingly common case. Nothing to do.
     * 2. **A convertible pair** (`kg` → `g`, `l` → `ml`) — rebased exactly.
     *    The quantity converts; the average is a price *per unit* and so moves
     *    the other way, which is why it is divided by the same factor rather
     *    than converted. `oldQty·oldAvg` — the money on the shelf — is
     *    unchanged by the rebase, which is the invariant worth holding onto.
     * 3. **Anything else** — refused. See {@see StrandedIngredientCostUnit}.
     *
     * An empty shelf is the one case where a non-convertible move is harmless:
     * there is no quantity to carry and no average to misapply, so the row
     * simply adopts the new unit. That is not a guess — nothing is being
     * converted — and it keeps a migration from stranding rows that had no
     * balance to strand.
     *
     * @param  numeric-string  $oldQuantity
     * @param  numeric-string  $oldAverage
     * @return array{numeric-string, numeric-string}
     */
    private function rebaseHeldBalance(
        IngredientStockCost $cost,
        Ingredient $ingredient,
        MeasurementUnit $ingredientUnit,
        string $oldQuantity,
        string $oldAverage,
    ): array {
        if ((string) $cost->unit_id === (string) $ingredientUnit->getKey()) {
            return [$oldQuantity, $oldAverage];
        }

        /** @var MeasurementUnit|null $heldUnit */
        $heldUnit = MeasurementUnit::query()->whereKey($cost->unit_id)->first();

        if (! $heldUnit instanceof MeasurementUnit) {
            throw new RuntimeException("Ingredient cost row references a measurement unit that does not exist [{$cost->unit_id}].");
        }

        if (bccomp($oldQuantity, '0', self::SCALE) === 0) {
            return ['0', '0'];
        }

        if (! $this->conversion->canConvert($heldUnit, $ingredientUnit)) {
            throw new StrandedIngredientCostUnit(
                $heldUnit->code,
                $ingredientUnit->code,
                (string) $ingredient->getKey(),
            );
        }

        $rebasedQuantity = $this->conversion->convert($oldQuantity, $heldUnit, $ingredientUnit);

        // Guarded rather than assumed: a quantity small enough to round to zero
        // in the new unit would make the division below a divide-by-zero, and
        // the money it represented is better written off loudly than crashed on.
        if (bccomp($rebasedQuantity, '0', self::SCALE) <= 0) {
            return ['0', '0'];
        }

        $heldValue = bcmul($oldQuantity, $oldAverage, self::WORKING_SCALE);
        $rebasedAverage = $this->round(bcdiv($heldValue, $rebasedQuantity, self::WORKING_SCALE));

        return [$this->round($rebasedQuantity), $rebasedAverage];
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
