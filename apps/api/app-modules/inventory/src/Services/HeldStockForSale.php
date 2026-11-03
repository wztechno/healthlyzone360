<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Cart\Contracts\QuarantinedStock;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Orders\Contracts\HeldStockLookup;
use Illuminate\Support\Facades\DB;

/**
 * Inventory's answer to Orders' {@see HeldStockLookup} and Cart's {@see QuarantinedStock}.
 *
 * What a sale draws is read exactly as consumption reads it: a thing sold from
 * finished stock draws its own ingredient, anything else is exploded by
 * {@see MealExplosion}. What is held is read straight from the tables — a
 * quality check is a soft reference to its subject, so there is no model edge to
 * follow: a receipt under a `hold` check holds every ingredient on its lines, and
 * a batch under one holds what it makes.
 *
 * Ingredient grain, not lot grain: stock is not tracked per receipt, so "some of
 * this shelf arrived on a held delivery" is the most the data can say — which is
 * exactly a warning's job. The refusal is a sharper question, answered by
 * {@see StockQuarantine}: whether anything but held stock is left to sell.
 */
final readonly class HeldStockForSale implements HeldStockLookup, QuarantinedStock
{
    public function __construct(private MealExplosion $explosion, private StockQuarantine $quarantine) {}

    public function refuses(string $organisationId, CatalogueItem $item, string $quantity): bool
    {
        // ponytail: how much of a finished shelf one sold unit takes is the consume
        // path's arithmetic, so the refusal asks only whether anything free is left.
        // A sale of more than is free meets the hold at the deduction.
        return $this->anyShelf($organisationId, $item, $quantity, $this->quarantine->coversOnlyHeld(...), '0.0001');
    }

    public function shortOfFree(string $organisationId, CatalogueItem $item, string $quantity): bool
    {
        // A finished shelf's draw is unknown here (see refuses()), so any hold on
        // it warns: a warning is the safe side to be wrong on.
        return $this->anyShelf($organisationId, $item, $quantity, $this->quarantine->shortOfFree(...), (string) PHP_INT_MAX);
    }

    /**
     * @param  callable(string, string, numeric-string): bool  $test  asked of each shelf the sale draws, with what it draws
     * @param  numeric-string  $finishedDraw  what a finished-stock sale is taken to draw
     */
    private function anyShelf(string $organisationId, CatalogueItem $item, string $quantity, callable $test, string $finishedDraw): bool
    {
        if (! $this->quarantine->anyHeld($organisationId)) {
            return false;
        }

        if ($item->sellsFromFinishedStock()) {
            $shelf = $item->ingredient_id === null ? null : $this->explosion->resolveStockItem($organisationId, (string) $item->ingredient_id, null);

            return $shelf instanceof StockItem && $test($organisationId, (string) $shelf->getKey(), $finishedDraw);
        }

        foreach ($this->explosion->explode($organisationId, $item, $quantity, null)->rows as $row) {
            if ($test($organisationId, $row['stock_item_id'], $row['quantity'])) {
                return true;
            }
        }

        return false;
    }

    public function heldFor(string $organisationId, ?string $branchId, CatalogueItem $item, string $quantity): array
    {
        $held = $this->heldIngredientIds($organisationId);

        if ($held === []) {
            return [];
        }

        $drawn = $item->sellsFromFinishedStock()
            ? ($item->ingredient_id === null ? [] : [(string) $item->ingredient_id])
            : array_map(
                static fn (array $row): string => $row['ingredient_id'],
                $this->explosion->explode($organisationId, $item, $quantity, $branchId)->rows,
            );

        $ids = array_values(array_intersect(array_unique($drawn), $held));

        if ($ids === []) {
            return [];
        }

        /** @var list<string> $names */
        $names = Ingredient::withoutTenancy()->whereIn('id', $ids)->orderBy('name_en')->pluck('name_en')->all();

        return $names;
    }

    /**
     * @return list<string>
     */
    private function heldIngredientIds(string $organisationId): array
    {
        $fromReceipts = DB::table('quality_checks as qc')
            ->join('goods_receipt_lines as line', 'line.goods_receipt_id', '=', 'qc.subject_id')
            ->join('stock_items as item', 'item.id', '=', 'line.stock_item_id')
            ->where('qc.organisation_id', $organisationId)
            ->where('qc.subject_type', 'goods_receipt')
            ->where('qc.status', 'hold')
            ->whereNotNull('item.ingredient_id')
            ->pluck('item.ingredient_id');

        $fromBatches = DB::table('quality_checks as qc')
            ->join('production_orders as batch', 'batch.id', '=', 'qc.subject_id')
            ->where('qc.organisation_id', $organisationId)
            ->where('qc.subject_type', 'production_order')
            ->where('qc.status', 'hold')
            ->whereNotNull('batch.production_item_ingredient_id')
            ->pluck('batch.production_item_ingredient_id');

        return array_values(array_unique(array_map(
            strval(...),
            [...$fromReceipts->all(), ...$fromBatches->all()],
        )));
    }
}
