<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\ConsumptionValuation;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Inventory\Services\MealExplosion;
use Healthy360\Procurement\Services\IngredientCostService;
use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Cooking a batch to stock: its raw materials and packaging leave their shelves, and what it makes
 * arrives on a shelf of its own — valued at what went into it.
 *
 * ## Why this exists beside order consumption
 *
 * A meal is made to order, so its ingredients leave the shelf when it sells ({@see MealExplosion}).
 * A sauce or dressing is made to stock: the batch is cooked earlier, and selling a bottle draws one
 * off the sauce's own shelf. So a sauce's inputs have to leave *here*, when it is cooked, or they
 * never leave at all — and the sauce has to arrive with a cost, or every bottle sold afterwards is
 * cost of goods of nothing.
 *
 * ## Derived, never typed
 *
 * The order names a recipe version and a planned yield, and everything booked follows from those
 * two: the version's lines and packaging scaled by planned ÷ stated yield
 * ({@see MealExplosion::explodeBatch()}), and the yield landing on the shelf of what the version
 * makes. Nobody types what a batch consumed. The recipe says, the same way it says for a sale.
 *
 * ## All or nothing
 *
 * One transaction. A line with no shelf, a unit that will not convert, a shelf that does not hold
 * enough: the whole batch is refused, nothing moves, and the refusal says why. A confirmed *order*
 * books what it can and records the gaps, because a customer is waiting. A batch is booked by
 * somebody standing at the stock, and the right answer to "the shelf does not hold enough flour" is
 * to count the flour.
 *
 * ## Valued at what went in
 *
 * Each input is valued at its moving average exactly as a sale values it
 * ({@see ConsumptionValuation}), and the yield arrives at the sum — blended into the made item's own
 * average as a purchase from the kitchen itself. The consumes carry
 * `reference_type = production_order`, which the cost report does not count: cooking moves value
 * from one shelf to another, and the sale is what turns it into cost of goods.
 *
 * If any input has no cost, the yield arrives unvalued and the made item's average is left alone. An
 * average built on part of a batch's cost would understate every bottle sold after it.
 */
final readonly class ProductionService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    private const string REFERENCE = 'production_order';

    public function __construct(
        private InventoryService $inventory,
        private MealExplosion $explosion,
        private ConsumptionValuation $valuation,
        private UnitConversionService $conversion,
        private IngredientCostService $costs,
    ) {}

    /**
     * Book a planned batch: consume its inputs, yield its output, mark it completed.
     *
     * Idempotent. An order that is already completed comes back as it stands, so a second press of
     * the button books nothing twice.
     *
     * @return array{order: ProductionOrder, yield: StockMovement|null}
     *
     * @throws ApiException
     */
    public function complete(ProductionOrder $order): array
    {
        return DB::transaction(function () use ($order): array {
            $locked = ProductionOrder::query()->whereKey($order->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status === 'completed') {
                return ['order' => $locked, 'yield' => $this->yieldOf($locked)];
            }

            if ($locked->status === 'cancelled') {
                throw $this->refused('A cancelled production order cannot be completed.');
            }

            $organisationId = (string) $locked->organisation_id;
            $branchId = (string) $locked->branch_id;
            $version = RecipeVersion::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereKey($locked->recipe_version_id)
                ->firstOrFail();

            $batches = $this->batches($locked, $version);
            $output = $this->output($organisationId, $version, $batches);
            $explosion = $this->explosion->explodeBatch($organisationId, $version, $batches, $branchId);

            if ($explosion->failures !== []) {
                throw $this->refused(
                    'This batch cannot be booked. '.implode(' ', array_column($explosion->failures, 'detail')),
                    ['reasons' => array_values(array_unique(array_column($explosion->failures, 'reason_code')))],
                );
            }

            if ($explosion->rows === []) {
                throw $this->refused('This recipe version has no lines to cook a batch from.');
            }

            $inputCost = '0';
            $currencies = [];
            $unvalued = false;

            foreach ($explosion->rows as $row) {
                $stockUnit = MeasurementUnit::query()->findOrFail($row['stock_unit_id']);
                $valued = $this->valuation->value($organisationId, $row['ingredient_id'], $stockUnit, $row['quantity']);
                $figures = is_array($valued) ? $valued : null;

                try {
                    $this->inventory->recordMovement(
                        $organisationId,
                        $branchId,
                        $row['stock_item_id'],
                        'consume',
                        '-'.$row['quantity'],
                        self::REFERENCE,
                        (string) $locked->getKey(),
                        notes: 'Production order '.$locked->getKey().' consumption.',
                        unitCostAmount: $figures['unit_cost_amount'] ?? null,
                        costAmount: $figures['cost_amount'] ?? null,
                        costCurrencyCode: $figures['currency_code'] ?? null,
                    );
                } catch (InsufficientStock $exception) {
                    throw $this->shortOf($row['stock_item_id'], $exception);
                }

                if ($figures === null) {
                    $unvalued = true;

                    continue;
                }

                $this->valuation->lowerBasis($figures['cost_id'], $figures['quantity_in_cost_unit']);
                $inputCost = bcadd($inputCost, $figures['cost_amount'], self::WORKING_SCALE);
                $currencies[$figures['currency_code']] = true;
            }

            // One currency or none: there is no exchange rate anywhere in this system, so a batch
            // bought in two is unvalued rather than summed across them.
            $currency = ! $unvalued && count($currencies) === 1 ? (string) array_key_first($currencies) : null;

            $yield = $this->yieldInto($locked, $output, $currency === null ? null : $this->round($inputCost), $currency);

            $locked->status = 'completed';
            $locked->save();

            return ['order' => $locked, 'yield' => $yield];
        });
    }

    /**
     * How many times over the version is being made: planned ÷ stated yield, both in the version's
     * yield unit. An order that plans no quantity is one batch as the version is written.
     *
     * Not rounded. Ten kilograms of a 1.7 kg sauce is 5.88… batches, and rounding it to something
     * tidier would restate the quantity the cook asked for.
     *
     * @return numeric-string
     *
     * @throws ApiException
     */
    private function batches(ProductionOrder $order, RecipeVersion $version): string
    {
        if ($order->planned_yield === null) {
            return '1';
        }

        $planned = $this->numeric((string) $order->planned_yield);
        $stated = $version->yield_quantity === null ? null : (string) $version->yield_quantity;

        if ($stated === null || ! is_numeric($stated) || bccomp($stated, '0', self::SCALE) !== 1) {
            throw $this->refused('The recipe version states no yield, so there is nothing to scale a planned quantity against.');
        }

        if (bccomp($planned, '0', self::SCALE) !== 1) {
            throw $this->refused('A batch has to plan to make something.');
        }

        return bcdiv($planned, $stated, self::WORKING_SCALE);
    }

    /**
     * What the batch makes, and how much of it.
     *
     * The version's own declared output when it has one — the primary, or the only one; that is how
     * an intermediate such as a pesto mix is stocked. Otherwise the sauce or dressing sold from this
     * recipe, whose ingredient is the shelf a bottle is sold from ({@see CatalogueItemType::Sauce}),
     * in the version's stated yield.
     *
     * Refused when neither answers, which is what a meal's recipe looks like: a meal is cooked when it
     * is ordered, and a batch of one booked to no shelf would take its ingredients twice — once here,
     * once more when each portion sells.
     *
     * ponytail: books the primary output only. A version that also yields a secondary product (a
     * trim) books that by hand until a kitchen has one.
     *
     * @param  numeric-string  $batches
     * @return array{ingredient: Ingredient, quantity: numeric-string, unit: MeasurementUnit}
     *
     * @throws ApiException
     */
    private function output(string $organisationId, RecipeVersion $version, string $batches): array
    {
        $declared = RecipeVersionOutput::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('recipe_version_id', $version->getKey())
            ->get();

        $output = $declared->firstWhere('is_primary', true) ?? ($declared->count() === 1 ? $declared->first() : null);

        if ($output instanceof RecipeVersionOutput) {
            $ingredientId = $output->ingredient_id;
            $quantity = (string) $output->output_quantity;
            $unitId = $output->unit_id;
        } else {
            $sold = CatalogueItem::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('recipe_id', $version->recipe_id)
                ->whereIn('item_type', [CatalogueItemType::Sauce, CatalogueItemType::Dressing])
                ->whereNotNull('ingredient_id')
                ->get();

            if ($sold->count() !== 1) {
                throw $this->refused($sold->isEmpty()
                    ? 'This recipe makes nothing that is kept on a shelf. A meal is cooked when it is ordered; a batch is for a sauce, a dressing or a component the recipe declares it makes.'
                    : 'More than one sauce or dressing is sold from this recipe, so there is no one shelf to put the batch on.');
            }

            if ($version->yield_quantity === null || $version->yield_unit_id === null) {
                throw $this->refused('The recipe version states no yield, so there is no quantity to put on the shelf.');
            }

            $ingredientId = (string) $sold->firstOrFail()->ingredient_id;
            $quantity = (string) $version->yield_quantity;
            $unitId = $version->yield_unit_id;
        }

        return [
            'ingredient' => Ingredient::withoutTenancy()->whereKey($ingredientId)->firstOrFail(),
            'quantity' => $this->round(bcmul($this->numeric($quantity), $batches, self::WORKING_SCALE)),
            'unit' => MeasurementUnit::query()->findOrFail($unitId),
        ];
    }

    /**
     * Put the batch on its shelf, valued at what went into it when every input could be valued.
     *
     * @param  array{ingredient: Ingredient, quantity: numeric-string, unit: MeasurementUnit}  $output
     * @param  numeric-string|null  $cost  the inputs' total cost, or null when any could not be valued
     *
     * @throws ApiException
     */
    private function yieldInto(ProductionOrder $order, array $output, ?string $cost, ?string $currency): StockMovement
    {
        $organisationId = (string) $order->organisation_id;
        $branchId = (string) $order->branch_id;
        $ingredient = $output['ingredient'];

        $stockItem = $this->explosion->resolveStockItem($organisationId, (string) $ingredient->getKey(), $branchId);

        if (! $stockItem instanceof StockItem || $stockItem->unit_id === null) {
            throw $this->refused(sprintf('%s has no shelf to put the batch on.', $ingredient->name_en));
        }

        $stockUnit = MeasurementUnit::query()->findOrFail($stockItem->unit_id);
        $inStockUnit = $this->conversion->convert($output['quantity'], $output['unit'], $stockUnit);

        $unitCost = null;

        if ($cost !== null && $currency !== null) {
            // The made item's average moves exactly as a delivery of it would: a purchase from the
            // kitchen itself, at what its inputs cost per unit made.
            $blended = $this->costs->recordPurchase(
                $organisationId,
                $ingredient,
                $output['quantity'],
                $output['unit'],
                $this->round(bcdiv($cost, $output['quantity'], self::WORKING_SCALE)),
                $currency,
            );
            $unitCost = $blended->last_purchase_cost_amount === null ? null : (string) $blended->last_purchase_cost_amount;
        }

        return $this->inventory->recordMovement(
            $organisationId,
            $branchId,
            (string) $stockItem->getKey(),
            'yield',
            $inStockUnit,
            self::REFERENCE,
            (string) $order->getKey(),
            notes: 'Production order '.$order->getKey().' yield.',
            unitCostAmount: $unitCost === null ? null : $this->numeric($unitCost),
            costAmount: $unitCost === null ? null : $cost,
            costCurrencyCode: $unitCost === null ? null : $currency,
        );
    }

    /** The yield an already-completed order booked, if it booked one. */
    private function yieldOf(ProductionOrder $order): ?StockMovement
    {
        return StockMovement::withoutTenancy()
            ->where('organisation_id', $order->organisation_id)
            ->where('reference_type', self::REFERENCE)
            ->where('reference_id', (string) $order->getKey())
            ->where('reason', 'yield')
            ->first();
    }

    /**
     * The shelf's own refusal, restated with the shelf's name — "not enough stock" does not tell a
     * cook which tub to count.
     */
    private function shortOf(string $stockItemId, InsufficientStock $exception): ApiException
    {
        $name = StockItem::withoutTenancy()->whereKey($stockItemId)->value('name_en');

        return new ApiException(
            ErrorCode::InventoryInsufficientStock,
            sprintf(
                'Not enough %s on the shelf for this batch: %s needed, %s held. Count it, or receive more, before booking the batch.',
                is_string($name) ? $name : $stockItemId,
                (string) ($exception->details['requested'] ?? '?'),
                (string) ($exception->details['available'] ?? '?'),
            ),
            $exception->details,
            previous: $exception,
        );
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function refused(string $message, array $details = []): ApiException
    {
        return new ApiException(ErrorCode::ResourceConflict, $message, $details);
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Production arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }

    /**
     * Round half away from zero to the six places the stock and cost columns store.
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
