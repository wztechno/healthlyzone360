<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * What one branch should order, and who from (§4).
 *
 * The builder screen's whole payload: the shortage queue, the quantities the
 * system is willing to suggest, and the suppliers each shortage could be bought
 * from. It decides nothing — no order is created here and slice 4 is what turns
 * these rows into drafts — so every field is either a fact read from the shelf
 * or a suggestion the person may overwrite.
 *
 * **Procurement reads Inventory models directly.** That is the declared module
 * direction ({@see SupplierItemLinkService}
 * makes the same call for the same reason); the reverse is the cycle
 * `ModuleRegistryTest` refuses. A proposal is a procurement question asked about
 * inventory data, so it lives on this side of the edge.
 *
 * ## There is no money in this response, on purpose
 *
 * Not one field here carries a price, a cost or a currency, and §5 is why: the
 * supply-order permission is *not* the cost permission. A stock-responsible
 * person who may decide what to buy is not thereby entitled to the valuation
 * ledger, and a payload that carried last prices "for reference" would hand
 * them the ledger through the side door. Cost-authorised screens may fetch the
 * last price separately, from the endpoint that already gates it. A structural
 * test pins the absence, because the way this rule breaks is somebody adding a
 * helpful column.
 *
 * ## Suggested quantity is par-only, and mostly it is null
 *
 * `par_level - quantity`, when a par is set and the difference is positive.
 * Never `reorder_threshold - quantity`, which is §2's second correction and
 * worth restating: the threshold is the *trigger*, compared inclusively, so
 * ordering exactly up to it lands the shelf back on the boundary that raised
 * the alarm — the item is low again the moment the delivery is booked in. A
 * kitchen that has set no par gets `null` and types the number itself, which is
 * an honest blank rather than a plausible wrong answer.
 *
 * ## Supplier resolution, in one query
 *
 * Preferred active supplier, else the sole active one, else nobody — and the
 * whole set of candidates alongside, because the person may disagree with all
 * three outcomes. Every link for every row is read in a single grouped query;
 * a queue of forty shortages must cost one read, not forty, which is the same
 * N+1 rule {@see LastPurchasePriceQuery} is built around.
 *
 * Archived suppliers are excluded from the options but not from the *diagnosis*:
 * a shelf whose only supplier was archived is `suppliers_archived`, which is a
 * different problem with a different fix (restore them, or link somebody else)
 * from a shelf nobody was ever linked to. Collapsing the two into one empty
 * dropdown would leave the person guessing which.
 */
final readonly class OrderProposalService
{
    /**
     * bcmath scale, matching `decimal(14,4)` on `stock_levels`.
     */
    private const int SCALE = 4;

    public function __construct(private SupplyNeedsQuery $needs) {}

    /**
     * The branch's proposal, queue first and requested rows after.
     *
     * `$requestedStockItemIds` are the **Add another item** picks: they join the
     * proposal whatever their level says, deduped against the queue so an item
     * that was already short is one row rather than two. They are validated as
     * this organisation's shelves by the controller, so anything reaching here
     * is owned; an id the caller owns but which has never moved at this branch
     * is answered with a zero on-hand and null thresholds rather than a
     * fabricated level row, because inventing one would put a shelf on the
     * branch's books that no movement ever created.
     *
     * @param  list<string>  $requestedStockItemIds
     * @return array{items: list<array<string, mixed>>, meta: array<string, mixed>}
     */
    public function propose(string $branchId, array $requestedStockItemIds = []): array
    {
        $queue = $this->queueLevels($branchId);

        $queued = $queue->map(fn (StockLevel $level): array => $this->rowFromLevel(
            $level,
            $branchId,
            SupplyNeedsQuery::isOutOfStock((string) $level->quantity) ? 'out_of_stock' : 'low_stock',
        ));

        // Partition rather than sort: the SQL already ordered the whole queue by
        // item name, and splitting a sorted list keeps each group sorted without
        // a second comparison. Out of stock first because that is the order a
        // person works the list in — nothing to cook with beats nearly nothing.
        $ordered = $queued->filter(static fn (array $row): bool => $row['origin'] === 'out_of_stock')
            ->merge($queued->filter(static fn (array $row): bool => $row['origin'] === 'low_stock'))
            ->merge($this->requestedRows($branchId, $requestedStockItemIds, $queue))
            ->values();

        $items = $this->withSuppliers($ordered);

        return [
            'items' => $items,
            'meta' => [
                'branch_id' => $branchId,
                // Counted from the labelled rows rather than re-queried, so the
                // meta cannot describe a list it is not attached to. Requested
                // rows are excluded from both tallies on purpose: they are what
                // somebody asked for, not what the branch is short of, and
                // folding them in would make this disagree with the hub badge.
                'out_of_stock_count' => $this->countWhere($items, 'origin', 'out_of_stock'),
                'low_stock_count' => $this->countWhere($items, 'origin', 'low_stock'),
                'unassigned_count' => count(array_filter($items, static fn (array $row): bool => $row['unassigned_reason'] !== null)),
                'requested_item_count' => $this->countWhere($items, 'origin', 'requested'),
            ],
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function countWhere(array $rows, string $key, string $value): int
    {
        return count(array_filter($rows, static fn (array $row): bool => $row[$key] === $value));
    }

    /**
     * The shortage queue, ordered in SQL.
     *
     * `name_en` then `code`: a person scanning the list reads names, and the
     * code breaks the tie because it is unique per organisation, so the same
     * shelves always come back in the same order. The join is what lets the sort
     * happen in Postgres instead of over a hydrated collection — the same shape
     * {@see Supplier::suppliedItems()} uses.
     *
     * @return Collection<int, StockLevel>
     */
    private function queueLevels(string $branchId): Collection
    {
        return $this->needs->forBranch($branchId)
            ->join('stock_items', 'stock_items.id', '=', 'stock_levels.stock_item_id')
            ->orderBy('stock_items.name_en')
            ->orderBy('stock_items.code')
            ->select('stock_levels.*')
            ->with('stockItem')
            ->get();
    }

    /**
     * The **Add another item** rows, deduped against the queue.
     *
     * Sorted by name like the queue groups rather than left in request order, so
     * that re-querying with the same set of ids twice returns the same list
     * twice — a builder that re-reads the proposal after each addition would
     * otherwise shuffle rows the person is typing into.
     *
     * @param  list<string>  $requestedStockItemIds
     * @param  Collection<int, StockLevel>  $queue
     * @return Collection<int, array<string, mixed>>
     */
    private function requestedRows(string $branchId, array $requestedStockItemIds, Collection $queue): Collection
    {
        $alreadyQueued = $queue->map(static fn (StockLevel $level): string => (string) $level->stock_item_id)->all();
        $wanted = array_values(array_diff(array_unique($requestedStockItemIds), $alreadyQueued));

        if ($wanted === []) {
            return new Collection;
        }

        $stockItems = StockItem::query()
            ->whereKey($wanted)
            ->orderBy('name_en')
            ->orderBy('code')
            ->get();

        // One read for every requested shelf's level, keyed by item. A level may
        // legitimately be absent — the item has never moved at this branch —
        // and the row is built from the item alone when it is.
        $levels = StockLevel::query()
            ->where('branch_id', $branchId)
            ->whereIn('stock_item_id', $stockItems->modelKeys())
            ->get()
            ->keyBy(static fn (StockLevel $level): string => (string) $level->stock_item_id);

        return $stockItems->map(function (StockItem $item) use ($branchId, $levels): array {
            $level = $levels->get((string) $item->getKey());

            return $level instanceof StockLevel
                ? $this->rowFromLevel($level, $branchId, 'requested', $item)
                : $this->rowFromItem($item, $branchId);
        })->values();
    }

    /**
     * One proposal row built from a real level.
     *
     * @param  'out_of_stock'|'low_stock'|'requested'  $origin
     * @return array<string, mixed>
     */
    private function rowFromLevel(StockLevel $level, string $branchId, string $origin, ?StockItem $stockItem = null): array
    {
        $item = $stockItem ?? $level->stockItem;
        $quantity = $this->decimal((string) $level->quantity);
        $threshold = $level->reorder_threshold === null ? null : $this->decimal((string) $level->reorder_threshold);
        $par = $level->par_level === null ? null : $this->decimal((string) $level->par_level);

        return $this->row(
            stockItem: $item,
            branchId: $branchId,
            origin: $origin,
            quantity: $quantity,
            threshold: $threshold,
            par: $par,
        );
    }

    /**
     * One proposal row for a requested shelf with no level at this branch.
     *
     * Zero on hand and no thresholds, which is the truth: the branch holds none
     * and has asked to be warned about none. `is_out_of_stock` follows from the
     * quantity rather than being suppressed, because a client handed
     * `quantity_on_hand: "0.0000"` and `is_out_of_stock: false` could not
     * reconcile the two — the flag is a reading of the number beside it, not a
     * statement about how the row got here. `origin` stays `requested`, which is
     * what keeps it out of the shortage tallies.
     *
     * @return array<string, mixed>
     */
    private function rowFromItem(StockItem $stockItem, string $branchId): array
    {
        return $this->row(
            stockItem: $stockItem,
            branchId: $branchId,
            origin: 'requested',
            quantity: $this->decimal('0'),
            threshold: null,
            par: null,
        );
    }

    /**
     * The wire shape of one row, before suppliers are attached.
     *
     * @param  'out_of_stock'|'low_stock'|'requested'  $origin
     * @param  numeric-string  $quantity
     * @param  numeric-string|null  $threshold
     * @param  numeric-string|null  $par
     * @return array<string, mixed>
     */
    private function row(
        ?StockItem $stockItem,
        string $branchId,
        string $origin,
        string $quantity,
        ?string $threshold,
        ?string $par,
    ): array {
        $suggested = $this->suggestedQuantity($quantity, $par);

        return [
            'stock_item_id' => $stockItem === null ? null : (string) $stockItem->getKey(),
            'item_code' => $stockItem?->code,
            'item_name_en' => $stockItem?->name_en,
            'unit_id' => $stockItem?->unit_id,
            'unit_code' => $stockItem?->unit_code,
            'branch_id' => $branchId,
            'quantity_on_hand' => $quantity,
            'reorder_threshold' => $threshold,
            'par_level' => $par,
            'is_out_of_stock' => SupplyNeedsQuery::isOutOfStock($quantity),
            // The honest per-row predicate, not the label. A shelf at zero with a
            // threshold set is genuinely both; `origin` is where the union's
            // "counted once, as out of stock" rule lives.
            'is_low' => InventoryService::isLowStock($threshold, $quantity),
            'origin' => $origin,
            'suggested_quantity' => $suggested,
            'suggested_quantity_basis' => $suggested === null ? 'none' : 'par',
            // Filled by withSuppliers(), declared here so every row has the same
            // keys in the same order whatever path built it.
            'supplier_options' => [],
            'suggested_supplier_id' => null,
            'unassigned_reason' => null,
        ];
    }

    /**
     * `par_level - quantity`, or nothing.
     *
     * Never the threshold: see the class docblock. A par at or below the current
     * quantity yields no suggestion rather than zero or a negative, because
     * "restock to a level you are already at" is not an order.
     *
     * @param  numeric-string  $quantity
     * @param  numeric-string|null  $par
     * @return numeric-string|null
     */
    private function suggestedQuantity(string $quantity, ?string $par): ?string
    {
        if ($par === null) {
            return null;
        }

        $difference = bcsub($par, $quantity, self::SCALE);

        return bccomp($difference, '0', self::SCALE) > 0 ? $difference : null;
    }

    /**
     * Attach every row's candidate suppliers in one grouped read.
     *
     * Ordered preferred-first then by name, so the options list a person opens
     * puts the obvious answer at the top and reads alphabetically after it. The
     * archived flag comes back with the row rather than being filtered in SQL,
     * because "there are links but they are all archived" is a diagnosis that
     * needs to see them.
     *
     * @param  Collection<int, array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private function withSuppliers(Collection $items): array
    {
        $stockItemIds = $items->pluck('stock_item_id')->filter()->unique()->values()->all();

        if ($stockItemIds === []) {
            return array_values($items->all());
        }

        $links = SupplierStockItem::query()
            ->join('suppliers', 'suppliers.id', '=', 'supplier_stock_items.supplier_id')
            ->whereIn('supplier_stock_items.stock_item_id', $stockItemIds)
            ->orderByDesc('supplier_stock_items.is_preferred')
            ->orderBy('suppliers.name_en')
            ->orderBy('suppliers.code')
            ->get([
                'supplier_stock_items.stock_item_id',
                'supplier_stock_items.is_preferred',
                'suppliers.id as supplier_id',
                'suppliers.code as supplier_code',
                'suppliers.name_en as supplier_name_en',
                'suppliers.name_ar as supplier_name_ar',
                'suppliers.lead_time_days as supplier_lead_time_days',
                'suppliers.archived_at as supplier_archived_at',
            ])
            ->groupBy(static fn (SupplierStockItem $link): string => (string) $link->stock_item_id);

        return array_values($items->map(function (array $row) use ($links): array {
            /** @var Collection<int, SupplierStockItem> $all */
            $all = $links->get((string) $row['stock_item_id'], new Collection);
            $active = $all->filter(static fn (SupplierStockItem $link): bool => $link->getAttribute('supplier_archived_at') === null)->values();

            $options = $active->map(static fn (SupplierStockItem $link): array => [
                'id' => (string) $link->getAttribute('supplier_id'),
                'code' => (string) $link->getAttribute('supplier_code'),
                'name_en' => (string) $link->getAttribute('supplier_name_en'),
                'name_ar' => $link->getAttribute('supplier_name_ar'),
                'is_preferred' => (bool) $link->is_preferred,
                'lead_time_days' => $link->getAttribute('supplier_lead_time_days') === null
                    ? null
                    : (int) $link->getAttribute('supplier_lead_time_days'),
            ])->all();

            $preferred = $active->first(static fn (SupplierStockItem $link): bool => (bool) $link->is_preferred);

            $row['supplier_options'] = $options;
            $row['suggested_supplier_id'] = match (true) {
                $preferred instanceof SupplierStockItem => (string) $preferred->getAttribute('supplier_id'),
                // Exactly one active candidate needs no preference to be the
                // obvious answer; two do, and the system offers none.
                $active->count() === 1 => (string) $active->first()?->getAttribute('supplier_id'),
                default => null,
            };
            $row['unassigned_reason'] = match (true) {
                $active->isNotEmpty() => null,
                $all->isNotEmpty() => 'suppliers_archived',
                default => 'no_supplier',
            };

            return $row;
        })->all());
    }

    /**
     * A decimal string at the stock scale, whatever scale it arrived at.
     *
     * The `is_numeric` guard is the one
     * {@see InventoryService} keeps for the same
     * reason: bcmath handed something it cannot read returns zero rather than
     * erroring, so a malformed quantity would reach the builder as a confident
     * `"0.0000"` and a shelf would look empty because a cast went wrong.
     *
     * @return numeric-string
     */
    private function decimal(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Order proposal received a non-numeric quantity [{$value}].");
        }

        return bcadd($value, '0', self::SCALE);
    }
}
