<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The shelves that repeat one name in a kitchen, sorted into what can be merged
 * without a person and what cannot.
 *
 * A kitchen's copy of a library ingredient used to get a shelf of its own, and
 * the automatic fork made copies nobody asked for, so one thing sat on two rows.
 * The owner's rule (2 November 2026): keep the row with history, add the
 * quantities, audit it, and send anything unclear to a review list.
 *
 * **Clear, and merged:** exactly two shelves, one a copy of the other's ingredient,
 * in one unit, and at most one with movements. The row with movements stays. With
 * none on either, the original stays.
 *
 * **Unclear, and listed:** everything else, each with its reason. Two shelves that
 * both have movements are on this list on purpose: the ledger is append-only and
 * cascades with its shelf, so dropping either would erase history, and
 * `MealExplosion::resolveStockItem()` keeps a copy and its original working
 * meanwhile. A row leaves the list when the kitchen deals with it.
 *
 * The list is computed rather than stored: a read of the shelves as they stand, so
 * it cannot go stale. Reads and the merge run inside one kitchen's tenant context.
 */
final readonly class DuplicateStockShelves
{
    private const string REFERENCE_TYPE = 'stock_merge';

    private const int SCALE = 6;

    public function __construct(
        private InventoryService $inventory,
        private AuditRecorder $audit,
    ) {}

    /**
     * @return array{
     *     merges: list<array{keep: StockItem, drop: StockItem}>,
     *     reviews: list<array{name: string, reason: string, shelves: list<array{id: string, code: string, unit_code: string, quantity: string, has_history: bool}>}>,
     *     empty_archived: list<StockItem>
     * }
     */
    public function scan(string $organisationId): array
    {
        $items = StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderBy('code')
            ->get();

        $ingredients = Ingredient::withoutTenancy()
            ->whereIn('id', $items->pluck('ingredient_id')->filter()->all())
            ->get(['id', 'forked_from_ingredient_id', 'status'])
            ->keyBy('id');

        $merges = [];
        $reviews = [];

        foreach ($items->groupBy(static fn (StockItem $item): string => mb_strtolower(trim($item->name_en))) as $shelves) {
            if ($shelves->count() < 2) {
                continue;
            }

            $reason = $this->unclearReason($shelves, $ingredients);

            if ($reason === null) {
                $merges[] = $this->pick($shelves, $ingredients);

                continue;
            }

            $reviews[] = [
                'name' => (string) $shelves->first()?->name_en,
                'reason' => $reason,
                'shelves' => array_values($shelves->map(fn (StockItem $shelf): array => [
                    'id' => (string) $shelf->getKey(),
                    'code' => $shelf->code,
                    'unit_code' => $shelf->unit_code,
                    'quantity' => number_format((float) StockLevel::withoutTenancy()->where('stock_item_id', $shelf->getKey())->sum('quantity'), 4, '.', ''),
                    'has_history' => $this->hasHistory($shelf),
                ])->all()),
            ];
        }

        $emptyArchived = $items->filter(function (StockItem $item) use ($ingredients): bool {
            $status = $ingredients[$item->ingredient_id]->status ?? null;

            return $status === IngredientStatus::Archived && $item->catalogue_item_id === null && self::isUnused($item);
        });

        return ['merges' => $merges, 'reviews' => $reviews, 'empty_archived' => array_values($emptyArchived->all())];
    }

    /**
     * Folds `$drop` into `$keep`: what it holds becomes an audited adjustment on
     * the kept shelf, what points at it follows, and the row goes.
     */
    public function merge(string $organisationId, StockItem $keep, StockItem $drop, ?string $actorUserId = null): void
    {
        DB::transaction(function () use ($organisationId, $keep, $drop, $actorUserId): void {
            $moved = [];

            foreach (StockLevel::withoutTenancy()->where('stock_item_id', $drop->getKey())->get() as $level) {
                $quantity = bcadd((string) $level->quantity, '0', self::SCALE);

                if (bccomp($quantity, '0', self::SCALE) !== 0) {
                    $this->inventory->recordMovement(
                        $organisationId,
                        (string) $level->branch_id,
                        (string) $keep->getKey(),
                        'adjust',
                        $quantity,
                        self::REFERENCE_TYPE,
                        (string) $drop->getKey(),
                        'Merged from '.$drop->code,
                    );
                    $moved[(string) $level->branch_id] = $quantity;
                }
            }

            DB::table('purchase_order_lines')->where('stock_item_id', $drop->getKey())->update(['stock_item_id' => $keep->getKey()]);
            DB::table('production_order_lines')->where('stock_item_id', $drop->getKey())->update(['stock_item_id' => $keep->getKey()]);

            $linked = DB::table('supplier_stock_items')->where('stock_item_id', $keep->getKey())->pluck('supplier_id');
            $hasPreferred = DB::table('supplier_stock_items')->where('stock_item_id', $keep->getKey())->where('is_preferred', true)->exists();

            DB::table('supplier_stock_items')->where('stock_item_id', $drop->getKey())->whereNotIn('supplier_id', $linked)->update(
                ['stock_item_id' => $keep->getKey()] + ($hasPreferred ? ['is_preferred' => false] : []),
            );

            $product = $drop->catalogue_item_id;
            $dropId = (string) $drop->getKey();

            $drop->delete();

            if ($product !== null) {
                $keep->catalogue_item_id = (string) $product;
                $keep->save();
            }

            $this->audit->record(
                'inventory.stock_merged',
                actorUserId: $actorUserId,
                subjectType: 'stock_item',
                subjectId: (string) $keep->getKey(),
                metadata: ['merged_stock_item_id' => $dropId, 'merged_code' => $drop->code, 'quantities_by_branch' => $moved],
            );
        });
    }

    /**
     * Takes away an empty shelf of an archived ingredient, on the record.
     */
    public function removeEmpty(StockItem $shelf, ?string $actorUserId = null): void
    {
        DB::transaction(function () use ($shelf, $actorUserId): void {
            $shelf->delete();

            $this->audit->record(
                'inventory.stock_shelf_removed',
                actorUserId: $actorUserId,
                subjectType: 'stock_item',
                subjectId: (string) $shelf->getKey(),
                metadata: ['code' => $shelf->code, 'ingredient_id' => $shelf->ingredient_id],
            );
        });
    }

    /**
     * An empty shelf nothing has touched: no movement, nothing held, nothing on
     * order or being produced against it. A supplier link is configuration and
     * goes with the row.
     */
    public static function isUnused(StockItem $item): bool
    {
        $id = $item->getKey();

        return ! StockMovement::withoutTenancy()->where('stock_item_id', $id)->exists()
            && ! StockLevel::withoutTenancy()->where('stock_item_id', $id)->where('quantity', '!=', 0)->exists()
            && ! DB::table('goods_receipt_lines')->where('stock_item_id', $id)->exists()
            && ! DB::table('purchase_order_lines')->where('stock_item_id', $id)->exists()
            && ! DB::table('production_order_lines')->where('stock_item_id', $id)->exists()
            && ! DB::table('stock_reservations')->where('stock_item_id', $id)->exists();
    }

    /**
     * @param  Collection<int, StockItem>  $shelves
     * @param  Collection<string, Ingredient>  $ingredients
     */
    private function unclearReason(Collection $shelves, Collection $ingredients): ?string
    {
        if ($shelves->pluck('unit_code')->unique()->count() > 1) {
            return 'different_units';
        }

        if ($shelves->count() !== 2 || ! $this->isCopyPair($shelves->values()->all(), $ingredients)) {
            return 'not_a_copy';
        }

        [$first, $second] = $shelves->values()->all();

        if ($this->hasHistory($first) && $this->hasHistory($second)) {
            return 'both_have_history';
        }

        if ($first->catalogue_item_id !== null && $second->catalogue_item_id !== null) {
            return 'both_sold_as_products';
        }

        $pick = $this->pick($shelves, $ingredients);

        return $this->blocksDrop($pick['drop'], $pick['keep']) ? 'open_work' : null;
    }

    /**
     * @param  list<StockItem>  $pair
     * @param  Collection<string, Ingredient>  $ingredients
     */
    private function isCopyPair(array $pair, Collection $ingredients): bool
    {
        [$first, $second] = $pair;

        return ($ingredients[$first->ingredient_id]->forked_from_ingredient_id ?? null) === $second->ingredient_id
            || ($ingredients[$second->ingredient_id]->forked_from_ingredient_id ?? null) === $first->ingredient_id;
    }

    /**
     * @param  Collection<int, StockItem>  $shelves
     * @param  Collection<string, Ingredient>  $ingredients
     * @return array{keep: StockItem, drop: StockItem}
     */
    private function pick(Collection $shelves, Collection $ingredients): array
    {
        [$first, $second] = $shelves->values()->all();

        if ($this->hasHistory($first)) {
            return ['keep' => $first, 'drop' => $second];
        }

        if ($this->hasHistory($second)) {
            return ['keep' => $second, 'drop' => $first];
        }

        $firstIsCopy = ($ingredients[$first->ingredient_id]->forked_from_ingredient_id ?? null) !== null;

        return $firstIsCopy ? ['keep' => $second, 'drop' => $first] : ['keep' => $first, 'drop' => $second];
    }

    /**
     * What would stop `$drop` going cleanly: a receipt or a reservation that would
     * cascade away with it, a figure the costing still carries, or a purchase or
     * production order holding both shelves, which the unique lines would refuse.
     */
    private function blocksDrop(StockItem $drop, StockItem $keep): bool
    {
        $dropId = $drop->getKey();
        $costed = IngredientStockCost::withoutTenancy()
            ->where('ingredient_id', $drop->ingredient_id)
            ->where('organisation_id', $drop->organisation_id)
            ->where('quantity_on_hand', '!=', 0)
            ->exists();

        return $costed
            || DB::table('goods_receipt_lines')->where('stock_item_id', $dropId)->exists()
            || DB::table('stock_reservations')->where('stock_item_id', $dropId)->exists()
            || $this->sharesAnOrder('purchase_order_lines', ['purchase_order_id'], $dropId, $keep->getKey())
            || $this->sharesAnOrder('production_order_lines', ['production_order_id', 'line_kind'], $dropId, $keep->getKey());
    }

    /**
     * @param  list<string>  $key
     */
    private function sharesAnOrder(string $table, array $key, mixed $dropId, mixed $keepId): bool
    {
        return DB::table($table.' as dropped')
            ->join($table.' as kept', static function ($join) use ($key): void {
                foreach ($key as $column) {
                    $join->on('dropped.'.$column, '=', 'kept.'.$column);
                }
            })
            ->where('dropped.stock_item_id', $dropId)
            ->where('kept.stock_item_id', $keepId)
            ->exists();
    }

    private function hasHistory(StockItem $item): bool
    {
        return StockMovement::withoutTenancy()->where('stock_item_id', $item->getKey())->exists();
    }
}
