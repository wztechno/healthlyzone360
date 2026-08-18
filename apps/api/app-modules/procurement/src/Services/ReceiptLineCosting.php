<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Procurement\Exceptions\MixedIngredientCostCurrency;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * What it means to settle one receipt line's money — in exactly one place
 * (§3.6).
 *
 * Two callers reach this: {@see GoodsReceiptService} when a delivery is posted
 * with prices on it, and {@see ReceiptPriceCompletionService} when the invoice
 * turns up days later. §3.6 requires that the second "calls the costing path
 * only for lines whose `costed_at` is null and never creates a second stock
 * movement", and the cheapest way to be sure both do the same arithmetic is for
 * there to be one piece of arithmetic.
 *
 * **This class has no `InventoryService`, and that absence is the guarantee.**
 * Settling a line's money cannot raise stock, because there is nothing here that
 * could. A test pins the constructor for that reason: the way "never move stock
 * twice" breaks is a helpful dependency being injected later.
 *
 * ## Four outcomes, and `settled` is wider than `blended`
 *
 * - `unpriced` — no price on the line yet. Nothing to do, `costed_at` stays
 *   null, and the line remains work in the **Unpriced receipts** queue.
 * - `blended` — the price went into the backing ingredient's weighted moving
 *   average, and `costed_at` is stamped.
 * - `settled` — there was nothing to blend into: no backing ingredient
 *   (packaging, cleaning supplies) or no purchase unit that could be resolved.
 *   `costed_at` is stamped anyway, because the line's money is finished and
 *   leaving it null would park its receipt in the work queue with no action
 *   available — the opposite of a work list.
 * - `pending_fx` — the price is recorded exactly as the supplier wrote it and
 *   the blend was refused because the ingredient's valuation is held in another
 *   currency. `costed_at` stays null and `valuation_pending_fx` is raised.
 *
 * That last one is §3.6's rule that physical receiving is never lost to a
 * currency. `IngredientCostService::recordPurchase` keeps its invariant — one
 * average, one currency, no invented rate — and this is the caller that knows
 * what to do when it is refused. A `UnitConversionUnsupported` is deliberately
 * **not** caught: a purchase unit with no ratio to the ingredient's unit is a
 * data error for somebody to fix, not a valuation waiting on a rate.
 */
final readonly class ReceiptLineCosting
{
    public function __construct(private IngredientCostService $costing) {}

    /**
     * Settle one line's money and save whatever that decided.
     *
     * The stock item may be passed in when the caller already has it — a posting
     * loop does — and is otherwise read through the relation.
     *
     * @return 'unpriced'|'blended'|'settled'|'pending_fx'
     */
    public function settle(string $organisationId, GoodsReceiptLine $line, ?StockItem $stockItem = null): string
    {
        if ($line->unit_price_amount === null || $line->cost_currency_code === null) {
            return 'unpriced';
        }

        $stockItem ??= $line->stockItem;

        if (! $stockItem instanceof StockItem || $stockItem->ingredient_id === null) {
            return $this->stamp($line, 'settled');
        }

        $purchaseUnit = $this->purchaseUnit($line->unit_id, $stockItem);

        if (! $purchaseUnit instanceof MeasurementUnit) {
            return $this->stamp($line, 'settled');
        }

        /** @var Ingredient $ingredient */
        $ingredient = Ingredient::withoutTenancy()->findOrFail($stockItem->ingredient_id);

        try {
            $this->costing->recordPurchase(
                $organisationId,
                $ingredient,
                (string) $line->quantity,
                $purchaseUnit,
                (string) $line->unit_price_amount,
                $line->cost_currency_code,
                (string) $line->getKey(),
            );
        } catch (MixedIngredientCostCurrency) {
            // The supplier's price stays exactly as written; only the valuation
            // waits. Nothing here invents an exchange rate, and a later
            // accounting phase may resolve it.
            $line->valuation_pending_fx = true;
            $line->save();

            return 'pending_fx';
        }

        return $this->stamp($line, 'blended');
    }

    /**
     * @param  'blended'|'settled'  $outcome
     * @return 'blended'|'settled'
     */
    private function stamp(GoodsReceiptLine $line, string $outcome): string
    {
        $line->costed_at = CarbonImmutable::now();
        $line->valuation_pending_fx = false;
        $line->save();

        return $outcome;
    }

    /**
     * The unit a priced line's price is quoted in — the line's own `unit_id`,
     * falling back to the stock item's unit when the line did not state one.
     */
    private function purchaseUnit(?string $unitId, StockItem $stockItem): ?MeasurementUnit
    {
        $resolved = $unitId ?? $stockItem->unit_id;

        return $resolved === null ? null : MeasurementUnit::query()->find($resolved);
    }
}
