<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use RuntimeException;

/**
 * What a quantity leaving a shelf cost the kitchen, and the one write that follows from taking it.
 *
 * Two things take stock off a shelf and must value it the same way: a confirmed order
 * ({@see OrderConsumptionService}) and a cooked batch (`ProductionService`). Both read the
 * ingredient's moving average, convert the quantity into the unit that average is per, and lower
 * the basis quantity without touching the average — the average only moves on a purchase. Written
 * once so a sauce's inputs are valued exactly as a meal's are.
 *
 * Reads are `withoutTenancy()` scoped to the organisation passed in, for the reason the order path
 * gives: a subscription-generated order can confirm inside a job whose ambient tenant is not the
 * seller.
 */
final readonly class ConsumptionValuation
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /** No moving average is held for the ingredient, so the quantity has no cost to carry. */
    public const string NO_COST = 'no_ingredient_cost';

    /** The shelf's unit will not convert to the unit the average is per. */
    public const string UNCONVERTIBLE = 'unit_conversion_unsupported';

    public function __construct(private UnitConversionService $conversion) {}

    /**
     * Value a quantity in the shelf's unit at the ingredient's moving average.
     *
     * Returns the reason instead of figures when it cannot: never a zero, which would read as a
     * free ingredient in a cost report.
     *
     * @param  numeric-string  $quantityInStockUnit
     * @return array{unit_cost_amount: numeric-string, cost_amount: numeric-string, currency_code: string, cost_id: string, quantity_in_cost_unit: numeric-string}|self::NO_COST|self::UNCONVERTIBLE
     */
    public function value(string $organisationId, string $ingredientId, MeasurementUnit $stockUnit, string $quantityInStockUnit): array|string
    {
        $cost = IngredientStockCost::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('ingredient_id', $ingredientId)
            ->first();

        if (! $cost instanceof IngredientStockCost || $cost->moving_average_cost_amount === null || $cost->currency_code === null) {
            return self::NO_COST;
        }

        $costUnit = MeasurementUnit::query()->find($cost->unit_id);

        if (! $costUnit instanceof MeasurementUnit) {
            return self::NO_COST;
        }

        try {
            $inCostUnit = $this->conversion->convert($quantityInStockUnit, $stockUnit, $costUnit);
        } catch (UnitConversionUnsupported) {
            return self::UNCONVERTIBLE;
        }

        $unitCost = $this->numeric((string) $cost->moving_average_cost_amount);

        return [
            'unit_cost_amount' => $unitCost,
            'cost_amount' => $this->round(bcmul($inCostUnit, $unitCost, self::WORKING_SCALE)),
            'currency_code' => $cost->currency_code,
            'cost_id' => (string) $cost->getKey(),
            'quantity_in_cost_unit' => $inCostUnit,
        ];
    }

    /**
     * Lower the moving-average basis quantity by what was valued, under a row lock. The average
     * itself is untouched.
     *
     * @param  numeric-string  $quantityInCostUnit
     */
    public function lowerBasis(string $costId, string $quantityInCostUnit): void
    {
        $cost = IngredientStockCost::withoutTenancy()
            ->whereKey($costId)
            ->lockForUpdate()
            ->first();

        if (! $cost instanceof IngredientStockCost) {
            return;
        }

        $cost->quantity_on_hand = bcsub($this->numeric((string) $cost->quantity_on_hand), $quantityInCostUnit, self::SCALE);
        $cost->save();
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Consumption valuation received a non-numeric value [{$value}].");
        }

        return $value;
    }

    /**
     * Round half away from zero to the six places the cost columns store.
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
