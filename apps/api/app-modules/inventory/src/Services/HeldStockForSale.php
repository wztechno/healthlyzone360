<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Orders\Contracts\HeldStockLookup;
use Illuminate\Support\Facades\DB;

/**
 * Inventory's answer to Orders' {@see HeldStockLookup}.
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
 * exactly a warning's job.
 */
final readonly class HeldStockForSale implements HeldStockLookup
{
    public function __construct(private MealExplosion $explosion) {}

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
