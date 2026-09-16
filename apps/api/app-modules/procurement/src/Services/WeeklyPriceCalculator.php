<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Procurement\Enums\WeeklyPriceCarryReason;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use RuntimeException;

/**
 * The weighted average an ingredient was bought at over one completed week
 * (PROD1):
 *
 *     weekly average unit price = total purchase cost ÷ total quantity purchased
 *
 * with every quantity normalised into the ingredient's own default unit first, so
 * a week that bought flour once by the kilo and once by the 500 g bag produces one
 * figure rather than two incomparable ones.
 *
 * ## Line subtotals only
 *
 * The numerator is `Σ goods_receipt_lines.line_total_amount` and nothing else.
 * Header discount, tax, delivery and other charges stay out, which is the rule the
 * procurement plan already states in §3.6 — "header charges are reported separately
 * from item spend and do not change an item's last unit price unless a future
 * landed-cost allocation feature explicitly distributes them". This is not that
 * feature. Folding tax into an ingredient's cost would also be wrong wherever input
 * VAT is recoverable, and nothing in this system records whether it is.
 *
 * ## The business date, not the instant
 *
 * The week is bounded by `goods_receipts.received_on` — the branch-local calendar
 * day — exactly as {@see ProcurementSpendQuery} groups its ISO weeks. A van
 * unloaded at 21:30 in Dubai is a Tuesday delivery, and a UTC instant would move it
 * between weeks depending on where the server is standing.
 *
 * ## Four ways a week says nothing, and none of them is zero
 *
 * 1. **No purchases.** Nothing was bought.
 * 2. **All lines unpriced.** Deliveries arrived, no invoice yet. The *Unpriced
 *    receipts* queue already exists for this.
 * 3. **Mixed currency.** Two currencies for one ingredient in one week. There is no
 *    exchange rate in this system (§4.4) and this is not the place to invent one.
 * 4. **Not convertible.** A purchase unit that will not convert into the
 *    ingredient's default unit — a price per `piece` against a shelf counted in
 *    kilograms. `canConvert()` is asked before any arithmetic, never after, because
 *    `package`-dimension units all share `base_ratio` 1 and a bare ratio division
 *    would silently make a bag equal a can.
 *
 * Each is reported as its own {@see WeeklyPriceCarryReason} rather than as a null,
 * because three of the four are work somebody has to do and one is a shrug.
 *
 * ## bcmath, never floats
 *
 * `SCALE` 6 is what the column stores, `WORKING_SCALE` 12 is what the sum and the
 * division run at, and every stored figure is rounded half away from zero exactly
 * once — the same discipline as {@see RecipeCostingService},
 * {@see IngredientCostService}, `UnitConversionService` and `MealExplosion`. The
 * four members are duplicated here rather than shared; that is the stated house
 * pattern, and five services already carry their own copies.
 */
final readonly class WeeklyPriceCalculator
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(private UnitConversionService $conversion) {}

    /**
     * Every ingredient this organisation bought during the week, and what each
     * one averaged.
     *
     * Ingredients with no purchases in the week are simply absent — the publisher
     * decides what to do about them, because "carry last week's price forward"
     * needs to know which ingredients exist at all, and that is a wider question
     * than this week's receipts can answer.
     *
     * One query for the lines, one for the units, one for the ingredients. The
     * `(organisation_id, received_on DESC)` index added with SUP5 is what the
     * first one reads.
     *
     * @return array<string, WeeklyPriceComputation> keyed by ingredient id
     */
    public function computeWeek(
        string $organisationId,
        CarbonImmutable $weekStartDate,
        CarbonImmutable $weekEndDate,
    ): array {
        $lines = $this->linesInWeek($organisationId, $weekStartDate, $weekEndDate);

        if ($lines === []) {
            return [];
        }

        $units = $this->unitsById();
        $ingredients = $this->ingredientsById($lines);

        /** @var array<string, list<array<string, mixed>>> $byIngredient */
        $byIngredient = [];

        foreach ($lines as $line) {
            $ingredientId = (string) $line['ingredient_id'];
            $byIngredient[$ingredientId][] = $line;
        }

        $results = [];

        foreach ($byIngredient as $ingredientId => $ingredientLines) {
            $ingredient = $ingredients[$ingredientId] ?? null;

            if (! $ingredient instanceof Ingredient) {
                continue;
            }

            $results[$ingredientId] = $this->averageFor($ingredient, $ingredientLines, $units);
        }

        return $results;
    }

    /**
     * One ingredient's week.
     *
     * The unpriced lines are counted and then set aside: they contribute quantity
     * history but no money (§3.7), so averaging them in would divide a real cost
     * by a quantity part of which was never costed — understating the price by
     * exactly the deliveries nobody has invoiced yet.
     *
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, MeasurementUnit>  $units
     */
    private function averageFor(Ingredient $ingredient, array $lines, array $units): WeeklyPriceComputation
    {
        $ingredientId = (string) $ingredient->getKey();
        $lineCount = count($lines);

        $priced = array_values(array_filter(
            $lines,
            static fn (array $line): bool => $line['line_total_amount'] !== null && $line['cost_currency_code'] !== null,
        ));

        $unpricedCount = $lineCount - count($priced);

        if ($priced === []) {
            return WeeklyPriceComputation::blocked(
                $ingredientId,
                WeeklyPriceCarryReason::AllLinesUnpriced,
                $lineCount,
                $unpricedCount,
            );
        }

        $currencies = array_unique(array_map(
            static fn (array $line): string => mb_strtoupper((string) $line['cost_currency_code']),
            $priced,
        ));

        if (count($currencies) > 1) {
            return WeeklyPriceComputation::blocked(
                $ingredientId,
                WeeklyPriceCarryReason::MixedCurrency,
                $lineCount,
                $unpricedCount,
            );
        }

        $ingredientUnit = $units[(string) $ingredient->default_unit_id] ?? null;

        if (! $ingredientUnit instanceof MeasurementUnit) {
            return WeeklyPriceComputation::blocked(
                $ingredientId,
                WeeklyPriceCarryReason::NotConvertible,
                $lineCount,
                $unpricedCount,
            );
        }

        $totalQuantity = '0';
        $totalCost = '0';

        foreach ($priced as $line) {
            // A null `unit_id` on a receipt line means the price was quoted per the
            // stock item's own unit, which is how a direct receipt with no stated
            // purchase unit is stored.
            $lineUnitId = $line['unit_id'] === null ? (string) $line['stock_unit_id'] : (string) $line['unit_id'];
            $lineUnit = $units[$lineUnitId] ?? null;

            if (! $lineUnit instanceof MeasurementUnit) {
                return WeeklyPriceComputation::blocked(
                    $ingredientId,
                    WeeklyPriceCarryReason::NotConvertible,
                    $lineCount,
                    $unpricedCount,
                );
            }

            // Asked, never assumed: `pack`, `bag`, `can`, `bottle` and `bunch` all
            // share dimension `package` with `base_ratio` 1, so a ratio division
            // across two of them would convert one-for-one and call a bag a can.
            if (! $this->conversion->canConvert($lineUnit, $ingredientUnit)) {
                return WeeklyPriceComputation::blocked(
                    $ingredientId,
                    WeeklyPriceCarryReason::NotConvertible,
                    $lineCount,
                    $unpricedCount,
                );
            }

            $quantity = $this->conversion->convert(
                $this->numeric((string) $line['quantity']),
                $lineUnit,
                $ingredientUnit,
            );

            $totalQuantity = bcadd($totalQuantity, $quantity, self::WORKING_SCALE);
            $totalCost = bcadd($totalCost, $this->numeric((string) $line['line_total_amount']), self::WORKING_SCALE);
        }

        // A week whose priced deliveries net to nothing — a returned quantity, a
        // zero-quantity correction — has no denominator. Refused rather than
        // divided, because the alternative is a division by zero or an average of
        // infinity, and neither is a price.
        if (bccomp($totalQuantity, '0', self::SCALE) <= 0) {
            return WeeklyPriceComputation::blocked(
                $ingredientId,
                WeeklyPriceCarryReason::NoPurchases,
                $lineCount,
                $unpricedCount,
            );
        }

        $average = $this->round(bcdiv($totalCost, $totalQuantity, self::WORKING_SCALE));

        return WeeklyPriceComputation::computed(
            $ingredientId,
            (string) $ingredientUnit->getKey(),
            $average,
            (string) array_values($currencies)[0],
            $this->round($totalQuantity),
            $this->round($totalCost),
            $lineCount,
            $unpricedCount,
        );
    }

    /**
     * Every receipt line in the week, with the ingredient behind its shelf.
     *
     * `withoutTenancy()` scoped explicitly to the organisation passed in: the
     * publisher runs inside a scheduled job whose ambient tenant is nobody, and a
     * read that depended on request context would quietly find nothing.
     *
     * @return list<array<string, mixed>>
     */
    private function linesInWeek(string $organisationId, CarbonImmutable $weekStartDate, CarbonImmutable $weekEndDate): array
    {
        /** @var list<array<string, mixed>> $rows */
        $rows = GoodsReceiptLine::query()
            ->join('goods_receipts', 'goods_receipts.id', '=', 'goods_receipt_lines.goods_receipt_id')
            ->join('stock_items', 'stock_items.id', '=', 'goods_receipt_lines.stock_item_id')
            ->where('goods_receipts.organisation_id', $organisationId)
            ->whereNotNull('stock_items.ingredient_id')
            ->whereBetween('goods_receipts.received_on', [$weekStartDate->toDateString(), $weekEndDate->toDateString()])
            ->orderBy('goods_receipt_lines.id')
            ->get([
                'goods_receipt_lines.id',
                'goods_receipt_lines.quantity',
                'goods_receipt_lines.unit_id',
                'goods_receipt_lines.line_total_amount',
                'goods_receipt_lines.cost_currency_code',
                'stock_items.ingredient_id',
                'stock_items.unit_id as stock_unit_id',
            ])
            ->map(static fn (GoodsReceiptLine $line): array => $line->getAttributes())
            ->all();

        return $rows;
    }

    /**
     * Every measurement unit, keyed by id, in one read.
     *
     * The whole table rather than the ids the week happens to name: it is twenty
     * rows of reference data with no timestamps, and a `whereIn` over it would
     * cost the same query while making the ingredient units a second one.
     * Hydrating per line would be an N+1.
     *
     * @return array<string, MeasurementUnit>
     */
    private function unitsById(): array
    {
        /** @var array<string, MeasurementUnit> $units */
        $units = MeasurementUnit::query()
            ->get()
            ->keyBy(static fn (MeasurementUnit $unit): string => (string) $unit->getKey())
            ->all();

        return $units;
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, Ingredient>
     */
    private function ingredientsById(array $lines): array
    {
        $ids = array_values(array_unique(array_map(
            static fn (array $line): string => (string) $line['ingredient_id'],
            $lines,
        )));

        /** @var array<string, Ingredient> $ingredients */
        $ingredients = Ingredient::withoutTenancy()
            ->whereIn('id', $ids)
            ->get(['id', 'default_unit_id'])
            ->keyBy(static fn (Ingredient $ingredient): string => (string) $ingredient->getKey())
            ->all();

        return $ingredients;
    }

    /**
     * Round half away from zero to the six places the columns store. Copied
     * deliberately from `IngredientCostService`: one rounding rule across the
     * money arithmetic is one fewer place for two answers to disagree.
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
     * bcmath handed a non-numeric string returns zero rather than erroring, so a
     * malformed amount would silently make an ingredient free.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Weekly price arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
