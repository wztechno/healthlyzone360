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
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
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
 * **A person's two answers (owner, 3 November 2026).** Merge
 * ({@see mergeWithHistory()}) links an emptied shelf to the one that stays: no
 * movement is touched and the row stays, so its history stays readable, but it
 * leaves every list and `MealExplosion::resolveStockItem()` follows the link. Keep
 * both ({@see dismiss()}) stamps the group, and a group whose rows are all stamped
 * is not listed; a new shelf of the same name brings it back.
 *
 * The list is computed rather than stored: a read of the shelves as they stand, so
 * it cannot go stale. Reads and the merge run inside one kitchen's tenant context.
 */
final readonly class DuplicateStockShelves
{
    private const string REFERENCE_TYPE = 'stock_merge';

    private const int SCALE = 6;

    /** Order states whose lines still change: they follow a merged shelf, and closed ones keep what they recorded. */
    private const array OPEN_ORDERS = [
        'purchase_order_lines' => ['purchase_orders', 'purchase_order_id', ['draft', 'issued', 'partially_received']],
        'production_order_lines' => ['production_orders', 'production_order_id', ['draft', 'confirmed', 'in_production']],
    ];

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
            ->whereNull('merged_into_stock_item_id')
            ->orderBy('code')
            ->get();

        $ingredients = Ingredient::withoutTenancy()
            ->whereIn('id', $items->pluck('ingredient_id')->filter()->all())
            ->get(['id', 'forked_from_ingredient_id', 'status'])
            ->keyBy('id');

        $merges = [];
        $reviews = [];

        foreach ($items->groupBy(static fn (StockItem $item): string => mb_strtolower(trim($item->name_en))) as $shelves) {
            if ($shelves->count() < 2 || $shelves->every(static fn (StockItem $shelf): bool => $shelf->duplicate_dismissed_at !== null)) {
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

            $this->moveSupplierLinks($keep, $drop);

            $product = $drop->catalogue_item_id;
            $dropId = (string) $drop->getKey();

            // A shelf linked into this one by an earlier merge with history would
            // be un-merged by the FK's null-on-delete; it follows to the kept shelf.
            DB::table('stock_items')->where('merged_into_stock_item_id', $dropId)->update(['merged_into_stock_item_id' => $keep->getKey()]);

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
                // Flat, as the audit contract asks, and no key containing "code", which its
                // redaction drops: the merged shelf's handle is its reference.
                metadata: [
                    'merged_stock_item_id' => $dropId,
                    'merged_reference' => $drop->code,
                    'quantities_by_branch' => array_map(
                        static fn (string $branch, string $quantity): string => $branch.': '.$quantity,
                        array_keys($moved),
                        array_values($moved),
                    ),
                ],
            );
        });
    }

    /**
     * Merges two shelves that both have history. `$drop` must already stand at
     * zero in every branch (count it out first, which values the loss). Nothing in
     * the ledger is updated or deleted, and the row stays so its history does: it
     * is linked to `$keep`, open order lines and supplier links follow, and lists
     * stop showing it.
     *
     * Refused with `resource.conflict` and a `reason`: `not_duplicates`,
     * `already_merged`, `different_units`, `both_sold_as_products`,
     * `stock_remaining` or `open_work`.
     */
    public function mergeWithHistory(string $organisationId, StockItem $keep, StockItem $drop, ?string $actorUserId = null): void
    {
        DB::transaction(function () use ($organisationId, $keep, $drop, $actorUserId): void {
            $keepId = (string) $keep->getKey();
            $dropId = (string) $drop->getKey();

            // Both rows re-read under one lock, in key order, so two merges of the
            // same pair in opposite directions cannot each link one to the other.
            $locked = StockItem::withoutTenancy()->whereKey([$keepId, $dropId])->orderBy('id')->lockForUpdate()->get()
                ->keyBy(static fn (StockItem $item): string => (string) $item->getKey());
            $keep = $locked[$keepId] ?? $keep;
            $drop = $locked[$dropId] ?? $drop;

            if ($keepId === $dropId
                || $keep->organisation_id !== $organisationId
                || $drop->organisation_id !== $organisationId
                || mb_strtolower(trim($keep->name_en)) !== mb_strtolower(trim($drop->name_en))) {
                $this->refuse('not_duplicates', 'Only two different shelves of the same name can be merged.');
            }

            if ($keep->merged_into_stock_item_id !== null || $drop->merged_into_stock_item_id !== null) {
                $this->refuse('already_merged', 'One of these shelves has already been merged.');
            }

            if ($keep->unit_code !== $drop->unit_code) {
                $this->refuse('different_units', 'These shelves count in different units, so they cannot be merged.');
            }

            if ($keep->catalogue_item_id !== null && $drop->catalogue_item_id !== null) {
                $this->refuse('both_sold_as_products', 'Both shelves are sold as products, so they cannot be merged.');
            }

            // The levels and the row are locked, so a movement in flight either
            // lands before this read or waits for the link (a first level insert
            // takes a key-share lock on the row). A write after the link is
            // refused by InventoryService::recordMovement().
            $held = StockLevel::withoutTenancy()->where('stock_item_id', $dropId)->lockForUpdate()->get()
                ->contains(static fn (StockLevel $level): bool => bccomp((string) $level->quantity, '0', self::SCALE) !== 0);

            if ($held) {
                $this->refuse('stock_remaining', 'Count '.$drop->code.' to zero in every branch before merging it.');
            }

            if ($this->blocksLink($drop, $keep)) {
                $this->refuse('open_work', 'Something open still depends on '.$drop->code.': a cost basis, a reservation, or an order holding both shelves.');
            }

            foreach (self::OPEN_ORDERS as $table => [$orders, $key, $open]) {
                DB::table($table)
                    ->where('stock_item_id', $dropId)
                    ->whereIn($key, DB::table($orders)->whereIn('status', $open)->select('id'))
                    ->update(['stock_item_id' => $keepId]);
            }

            $this->moveSupplierLinks($keep, $drop);
            // What stayed duplicates a supplier the kept shelf already has. These are
            // configuration, not history, and left here they would offer the hidden
            // shelf on a purchase order.
            DB::table('supplier_stock_items')->where('stock_item_id', $dropId)->delete();

            // A shelf merged into this one earlier now points at the one that stays,
            // so a link is always one step.
            DB::table('stock_items')->where('merged_into_stock_item_id', $dropId)->update(['merged_into_stock_item_id' => $keepId]);

            $product = $drop->catalogue_item_id;
            $drop->catalogue_item_id = null;
            $drop->merged_into_stock_item_id = $keepId;
            $drop->save();

            if ($product !== null) {
                $keep->catalogue_item_id = (string) $product;
                $keep->save();
            }

            $this->audit->record(
                'inventory.stock_merged',
                actorUserId: $actorUserId,
                subjectType: 'stock_item',
                subjectId: $keepId,
                metadata: ['merged_stock_item_id' => $dropId, 'merged_code' => $drop->code, 'origin' => 'with_history'],
            );
        });
    }

    /**
     * "Keep both": stamps the shelves so their group leaves the review list until
     * a new shelf of the same name joins it.
     *
     * @param  list<string>  $stockItemIds
     */
    public function dismiss(string $organisationId, array $stockItemIds, ?string $actorUserId = null): void
    {
        DB::transaction(function () use ($organisationId, $stockItemIds, $actorUserId): void {
            $shelves = StockItem::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereKey($stockItemIds)
                ->get();

            if ($shelves->count() !== count(array_unique($stockItemIds))) {
                throw new ApiException(ErrorCode::ResourceNotFound);
            }

            StockItem::withoutTenancy()->whereKey($shelves->modelKeys())->update(['duplicate_dismissed_at' => now()]);

            $this->audit->record(
                'inventory.duplicate_dismissed',
                actorUserId: $actorUserId,
                subjectType: 'stock_item',
                subjectId: (string) $shelves->first()?->getKey(),
                // `shelves`, not `codes`: the recorder redacts any key containing "code".
                metadata: [
                    'stock_item_ids' => array_values(array_map(strval(...), $shelves->modelKeys())),
                    'shelves' => array_values(array_map(strval(...), $shelves->pluck('code')->all())),
                ],
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

        if ($shelves->count() !== 2 || ! $this->isCopyPair(array_values($shelves->all()), $ingredients)) {
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
     * What stops a shelf with history being linked rather than dropped: a cost
     * basis its own ingredient still carries, an open claim on it, an open
     * order holding both shelves, which the unique lines would refuse, or an
     * unresolved consumption exception on an order that consumed from it.
     * Receipts stay where they are, so they block nothing.
     *
     * The exception case: a retry asks whether its line already took from the
     * shelf it now resolves to. After a merge that is the kept shelf, which never
     * saw the consume, so the retry would deduct a second time.
     */
    private function blocksLink(StockItem $drop, StockItem $keep): bool
    {
        $costed = $drop->ingredient_id !== null
            && $drop->ingredient_id !== $keep->ingredient_id
            && IngredientStockCost::withoutTenancy()
                ->where('ingredient_id', $drop->ingredient_id)
                ->where('organisation_id', $drop->organisation_id)
                ->where('quantity_on_hand', '!=', 0)
                ->exists();

        return $costed
            || DB::table('stock_reservations')->where('stock_item_id', $drop->getKey())->where('status', 'open')->exists()
            || DB::table('order_consumption_exceptions as exception')
                ->whereNull('exception.resolved_at')
                ->whereExists(static fn ($consumed) => $consumed->from('stock_movements')
                    ->whereColumn('stock_movements.reference_id', 'exception.order_id')
                    ->where('stock_movements.reference_type', 'order')
                    ->where('stock_movements.reason', 'consume')
                    ->where('stock_movements.stock_item_id', $drop->getKey()))
                ->exists()
            || $this->sharesAnOrder('purchase_order_lines', ['purchase_order_id'], $drop->getKey(), $keep->getKey(), openOnly: true)
            || $this->sharesAnOrder('production_order_lines', ['production_order_id', 'line_kind'], $drop->getKey(), $keep->getKey(), openOnly: true);
    }

    /**
     * Supplier links follow the kept shelf, except to a supplier it already has;
     * the kept shelf's preferred supplier stays the preferred one.
     */
    private function moveSupplierLinks(StockItem $keep, StockItem $drop): void
    {
        $linked = DB::table('supplier_stock_items')->where('stock_item_id', $keep->getKey())->pluck('supplier_id');
        $hasPreferred = DB::table('supplier_stock_items')->where('stock_item_id', $keep->getKey())->where('is_preferred', true)->exists();

        DB::table('supplier_stock_items')->where('stock_item_id', $drop->getKey())->whereNotIn('supplier_id', $linked)->update(
            ['stock_item_id' => $keep->getKey()] + ($hasPreferred ? ['is_preferred' => false] : []),
        );
    }

    private function refuse(string $reason, string $message): never
    {
        throw new ApiException(ErrorCode::ResourceConflict, $message, ['reason' => $reason]);
    }

    /**
     * @param  list<string>  $key
     */
    private function sharesAnOrder(string $table, array $key, mixed $dropId, mixed $keepId, bool $openOnly = false): bool
    {
        [$orders, $orderKey, $open] = self::OPEN_ORDERS[$table];

        return DB::table($table.' as dropped')
            ->join($table.' as kept', static function ($join) use ($key): void {
                foreach ($key as $column) {
                    $join->on('dropped.'.$column, '=', 'kept.'.$column);
                }
            })
            ->where('dropped.stock_item_id', $dropId)
            ->where('kept.stock_item_id', $keepId)
            ->when($openOnly, static fn ($query) => $query->whereIn('dropped.'.$orderKey, DB::table($orders)->whereIn('status', $open)->select('id')))
            ->exists();
    }

    private function hasHistory(StockItem $item): bool
    {
        return StockMovement::withoutTenancy()->where('stock_item_id', $item->getKey())->exists();
    }
}
