<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\BatchExplosionResult;
use Healthy360\Inventory\Services\MealExplosion;
use Healthy360\Inventory\Services\ReservationService;
use Healthy360\Production\Models\ProductionOrderLine;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\WeeklyLineCost;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use RuntimeException;

/**
 * What a batch would need, against what the shelves can actually give (PROD1).
 *
 * **Writes nothing.** It is the read half of the production desk, and the split
 * is the same one {@see MealExplosion} draws for sales: the planning screen
 * renders this, the confirm path reserves against it, and a test asserts it,
 * without any of the three learning the others' job. A confirm that re-derived
 * the plan with its own arithmetic would drift from the number the kitchen
 * agreed to, on exactly the recipes that are hardest to reason about.
 *
 * ## Availability excludes this batch's own claim
 *
 * A confirmed order re-opened on the planning screen must not appear to have run
 * out of everything it already holds. `$holderId` is how the caller says "ignore
 * what I have already claimed", and {@see ReservationService} answers the
 * question that way throughout.
 *
 * ## The estimate is withheld rather than partial
 *
 * Any uncosted line, or two currencies among the lines, and the batch total is
 * null with the reason recorded. A total over the lines that happened to have
 * prices reads exactly like a complete one and is **smaller**, which is the
 * direction that gets a kitchen into trouble.
 *
 * That never blocks anything: {@see BatchPlan::isConfirmable()} does not consult
 * cost at all, because the house rule is that a kitchen about to cook is not
 * refused over arithmetic nobody has finished.
 *
 * ## Why the cost comes from the recipe layer
 *
 * {@see WeeklyRecipeCostingService::unitCostsFor()} answers "what does one unit of
 * this ingredient cost, and on whose authority" — published weekly price, the
 * recipe that makes it, a typed fallback, or nothing — and a technical sheet asks
 * the same question about the same ingredients. Two implementations would
 * disagree, and the two surfaces they feed sit next to each other.
 */
final readonly class ProductionPlanningService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    /** The scale every shelf comparison runs at — `stock_levels.quantity`'s own. */
    private const int COMPARISON_SCALE = 4;

    public function __construct(
        private MealExplosion $explosion,
        private ReservationService $reservations,
        private WeeklyRecipeCostingService $costing,
    ) {}

    /**
     * Plan `$batchFactor` batches of `$version` against one branch's shelves.
     *
     * @param  string  $batchFactor  how many times over the recipe is made
     * @param  string|null  $holderType  the claim to ignore — a confirmed order re-reading its own plan
     * @param  string|null  $publicationId  pin the estimate to one published week; null reads whatever is standing
     */
    public function plan(
        string $organisationId,
        string $branchId,
        RecipeVersion $version,
        string $batchFactor,
        ?string $holderType = null,
        ?string $holderId = null,
        ?string $publicationId = null,
    ): BatchPlan {
        $factor = $this->numeric($batchFactor);

        $explosion = $this->explosion->explodeBatch($organisationId, $version, $factor, $branchId);

        $stockItemIds = $this->stockItemIds($explosion);

        if ($stockItemIds === []) {
            return new BatchPlan(
                failures: $explosion->failures,
                weeklyPricePublicationId: $publicationId,
                batchFactor: $factor,
            );
        }

        $levels = $this->onHandByStockItem($organisationId, $branchId, $stockItemIds);
        $claims = $this->reservations->openTotals($branchId, $stockItemIds);
        $costs = $this->costsFor($organisationId, $explosion, $publicationId);

        $ingredients = $this->linesFor(
            $explosion->ingredients,
            ProductionOrderLine::KIND_INGREDIENT,
            $levels,
            $claims,
            $costs,
            $branchId,
            $holderType,
            $holderId,
        );

        $packaging = $this->linesFor(
            $explosion->packaging,
            ProductionOrderLine::KIND_PACKAGING,
            $levels,
            $claims,
            $costs,
            $branchId,
            $holderType,
            $holderId,
        );

        [$total, $currency, $uncosted, $conflict] = $this->totalFor([...$ingredients, ...$packaging]);

        return new BatchPlan(
            ingredients: $ingredients,
            packaging: $packaging,
            failures: $explosion->failures,
            estimatedCostAmount: $total,
            currencyCode: $currency,
            uncostedLines: $uncosted,
            currencyConflict: $conflict,
            weeklyPricePublicationId: $publicationId,
            batchFactor: $factor,
        );
    }

    /**
     * @return list<string>
     */
    private function stockItemIds(BatchExplosionResult $explosion): array
    {
        $ids = [];

        foreach ([...$explosion->ingredients, ...$explosion->packaging] as $row) {
            $ids[$row['stock_item_id']] = true;
        }

        return array_values(array_map(strval(...), array_keys($ids)));
    }

    /**
     * One query for every shelf the batch touches.
     *
     * A shelf with no level row reads as zero rather than as unknown: the row is
     * created by the first movement, so its absence is a shelf nothing has ever
     * been received onto. Publishing it as an unknown would put an em dash where
     * the cook most needs a number.
     *
     * @param  list<string>  $stockItemIds
     * @return array<string, numeric-string>
     */
    private function onHandByStockItem(string $organisationId, string $branchId, array $stockItemIds): array
    {
        $levels = StockLevel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('branch_id', $branchId)
            ->whereIn('stock_item_id', $stockItemIds)
            ->get(['stock_item_id', 'quantity']);

        $onHand = [];

        foreach ($levels as $level) {
            $onHand[(string) $level->stock_item_id] = $this->numeric((string) $level->quantity);
        }

        /** @var array<string, numeric-string> $onHand */
        return $onHand;
    }

    /**
     * One unit cost per ingredient, in that ingredient's **shelf** unit.
     *
     * The shelf unit rather than the recipe line's, because the explosion already
     * converted every quantity into it: costing in one unit and measuring in
     * another is how a batch of dressing comes out priced by the litre and
     * measured by the millilitre.
     *
     * @return array<string, WeeklyLineCost>
     */
    private function costsFor(string $organisationId, BatchExplosionResult $explosion, ?string $publicationId): array
    {
        $unitByIngredient = [];

        foreach ([...$explosion->ingredients, ...$explosion->packaging] as $row) {
            $unitByIngredient[$row['ingredient_id']] = $row['stock_unit_id'];
        }

        return $this->costing->unitCostsFor($organisationId, $unitByIngredient, $publicationId);
    }

    /**
     * @param  list<array{stock_item_id: string, stock_unit_id: string, ingredient_id: string, quantity: numeric-string}>  $rows
     * @param  'ingredient'|'packaging'  $kind
     * @param  array<string, numeric-string>  $levels
     * @param  array<string, numeric-string>  $claims
     * @param  array<string, WeeklyLineCost>  $costs
     * @return list<BatchPlanLine>
     */
    private function linesFor(
        array $rows,
        string $kind,
        array $levels,
        array $claims,
        array $costs,
        string $branchId,
        ?string $holderType,
        ?string $holderId,
    ): array {
        $lines = [];

        foreach ($rows as $row) {
            $stockItemId = $row['stock_item_id'];
            $onHand = $levels[$stockItemId] ?? '0';

            // A batch never counts its own claim against itself: without the
            // exclusion, re-opening a confirmed order would show it short of
            // everything it already holds.
            $reserved = $holderType !== null && $holderId !== null
                ? $this->reservations->reservedQuantity($branchId, $stockItemId, $holderType, $holderId)
                : ($claims[$stockItemId] ?? '0');

            $available = bcsub($onHand, $reserved, self::COMPARISON_SCALE);
            $required = $row['quantity'];

            $missing = bccomp($required, $available, self::COMPARISON_SCALE) > 0
                ? bcsub($required, $available, self::COMPARISON_SCALE)
                : bcadd('0', '0', self::COMPARISON_SCALE);

            $cost = $costs[$row['ingredient_id']] ?? null;
            $unitCost = $cost?->unitCostAmount;

            $lines[] = new BatchPlanLine(
                stockItemId: $stockItemId,
                ingredientId: $row['ingredient_id'],
                kind: $kind,
                unitId: $row['stock_unit_id'],
                required: $required,
                onHand: bcadd($onHand, '0', self::COMPARISON_SCALE),
                reserved: bcadd($reserved, '0', self::COMPARISON_SCALE),
                available: $available,
                missing: $missing,
                estimatedUnitCost: $unitCost,
                estimatedLineCost: $unitCost === null
                    ? null
                    : $this->round(bcmul($required, $unitCost, self::WORKING_SCALE)),
                currencyCode: $cost?->currencyCode,
                costSource: $this->costSource($cost),
                sourceRecipeVersionId: $cost?->sourceRecipeVersionId,
                effectiveFrom: $cost?->effectiveFrom,
            );
        }

        return $lines;
    }

    /**
     * The recipe layer's four-source vocabulary, in the two words the production
     * tables store.
     *
     * `component_recipe` and `ingredient_fallback` become `component` and
     * `fallback`: the same three answers, spelled the way
     * `production_order_lines.cost_source` spells them. The mapping is explicit so
     * a fifth source upstream fails loudly here rather than being written as a
     * value the CHECK will not accept.
     *
     * @return 'weekly'|'component'|'fallback'|'none'
     */
    private function costSource(?WeeklyLineCost $cost): string
    {
        if ($cost === null) {
            return 'none';
        }

        return match ($cost->source) {
            WeeklyLineCost::SOURCE_WEEKLY => ProductionOrderLine::SOURCE_WEEKLY,
            WeeklyLineCost::SOURCE_COMPONENT => ProductionOrderLine::SOURCE_COMPONENT,
            WeeklyLineCost::SOURCE_FALLBACK => ProductionOrderLine::SOURCE_FALLBACK,
            WeeklyLineCost::SOURCE_NONE => 'none',
            default => throw new RuntimeException('Unknown weekly cost source ['.$cost->source.'].'),
        };
    }

    /**
     * The batch total, or the reason there is not one.
     *
     * @param  list<BatchPlanLine>  $lines
     * @return array{0: numeric-string|null, 1: string|null, 2: list<string>, 3: bool}
     */
    private function totalFor(array $lines): array
    {
        $total = '0';
        $currency = null;
        $uncosted = [];
        $conflict = false;

        foreach ($lines as $line) {
            if (! $line->isCosted() || $line->estimatedLineCost === null || $line->currencyCode === null) {
                $uncosted[] = $line->stockItemId;

                continue;
            }

            if ($currency === null) {
                $currency = $line->currencyCode;
            } elseif ($currency !== $line->currencyCode) {
                // No exchange rate exists anywhere in this system, and inventing
                // one to make a batch total would be the single worst number on
                // the screen.
                $conflict = true;
            }

            $total = bcadd($total, $line->estimatedLineCost, self::WORKING_SCALE);
        }

        if ($conflict || $uncosted !== [] || $currency === null) {
            return [null, $conflict ? null : $currency, $uncosted, $conflict];
        }

        return [$this->round($total), $currency, [], false];
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Batch planning received a non-numeric quantity [{$value}].");
        }

        return $value;
    }

    /**
     * Round half away from zero to six places — the house rule, and the same
     * three lines every money-and-stock service carries.
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
