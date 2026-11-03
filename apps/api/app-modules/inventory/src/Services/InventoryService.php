<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Jobs\RetryOpenConsumptionExceptions;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * The one path that mutates stock, and the one place two correctness rules that
 * were missing in v1 now live (INV1.0).
 *
 * 1. **Locked, bcmath read-modify-write.** The balance used to be read, added
 *    to as a float, and written back with no lock — two concurrent movements
 *    could each read the same starting quantity and the second would overwrite
 *    the first, losing a delta silently. The read is now `lockForUpdate` inside
 *    the transaction, so concurrent movements serialise on the row, and the
 *    arithmetic is bcmath on decimal strings, so `0.1 + 0.2` is `0.3` rather
 *    than a float's `0.30000000000000004`.
 * 2. **No shelf goes below zero.** A consume is refused when it would take
 *    more than is *available* (on hand less other holders' claims). Every other
 *    movement — `adjust`, `waste`, a batch's discarded input — is refused when it
 *    would take more than is *on hand*. Both answer `inventory.insufficient_stock`.
 *    A count that comes up short is still recorded, through {@see recordCount()}:
 *    the kitchen states what the shelf holds, which is never below zero, rather
 *    than a delta that could be.
 */
final readonly class InventoryService
{
    /**
     * Working precision for the balance. Six places matches the costing layer;
     * the column stores four and rounds the last two away on write.
     */
    private const int SCALE = 6;

    /** Why food was thrown away. A note is required only for `other`. */
    public const array WASTE_REASONS = ['expired', 'spoiled', 'damaged', 'overproduced', 'customer_return', 'other'];

    public function __construct(
        private ReservationService $reservations,
        private AuditRecorder $audit,
        private ConsumptionValuation $valuation,
        private TenantContext $context,
    ) {}

    /**
     * @param  string  $quantityDelta  a signed decimal string; negative removes stock. Narrowed to a numeric-string by {@see numeric()} before any arithmetic.
     * @param  numeric-string|null  $unitCostAmount  the moving-average cost this movement is valued at, per the ingredient default unit — set only by the consume path (INV1.2), which captures COGS here because the order tables may not
     * @param  numeric-string|null  $costAmount  this movement's COGS: unit cost × quantity consumed
     * @param  string|null  $costCurrencyCode  required when either cost amount is given (the CHECK on the column enforces it)
     * @param  string|null  $orderLineId  the order line a consume served, so COGS attributes per line and kind (INV1.5); null on every non-consume movement
     * @param  string|null  $soldItemType  `meal` or `product`, denormalised from the sold catalogue item so the report splits COGS by line of business without a join (INV1.5)
     * @param  string|null  $holderType  the claim this movement consumes against, so a batch is checked against everyone else's reservations rather than its own (PROD1)
     * @param  string|null  $holderId  the holder id, paired with `$holderType`; both or neither
     * @param  string|null  $wasteReason  one of {@see self::WASTE_REASONS}, on a `waste` movement only
     *
     * @throws InsufficientStock when a consume would drive available stock below zero, or any other movement would drive on-hand below zero
     */
    public function recordMovement(
        string $organisationId,
        string $branchId,
        string $stockItemId,
        string $reason,
        string $quantityDelta,
        ?string $referenceType = null,
        ?string $referenceId = null,
        ?string $notes = null,
        ?string $unitCostAmount = null,
        ?string $costAmount = null,
        ?string $costCurrencyCode = null,
        ?string $orderLineId = null,
        ?string $soldItemType = null,
        ?string $holderType = null,
        ?string $holderId = null,
        ?string $wasteReason = null,
    ): StockMovement {
        $delta = $this->numeric($quantityDelta);

        return DB::transaction(function () use ($organisationId, $branchId, $stockItemId, $reason, $delta, $referenceType, $referenceId, $notes, $unitCostAmount, $costAmount, $costCurrencyCode, $orderLineId, $soldItemType, $holderType, $holderId, $wasteReason): StockMovement {
            $level = $this->lockLevel($organisationId, $branchId, $stockItemId);

            $currentQuantity = $this->numeric((string) $level->quantity);
            $newQuantity = bcadd($currentQuantity, $delta, self::SCALE);

            /*
             * A consume is checked against **available** stock, not against what
             * is physically on the shelf (PROD1).
             *
             * On-hand was the right question while nothing could claim stock in
             * advance. Once a confirmed production order can, it stops being: the
             * oil for Thursday's dressing is on the shelf on Wednesday, and a
             * customer order that eats it leaves Thursday short with nothing
             * visibly wrong anywhere. So a sale may take what is free, and what is
             * spoken for stays spoken for.
             *
             * A batch consuming its **own** claim passes its holder and is checked
             * against everyone else's — without that it would be refused by the
             * very reservation it opened, which is the one thing that must never
             * happen.
             *
             * Every other reason is held to on-hand alone, not to available: a
             * stock count or a spill is a fact about the shelf, and it may
             * legitimately leave a confirmed batch short —
             * {@see ReservationService::isShort()} reports that rather than
             * prevents it. What it may not do is leave less than nothing.
             */
            if ($reason === 'consume') {
                $reserved = $this->reservations->reservedQuantity($branchId, $stockItemId, $holderType, $holderId);
                $availableAfter = bcsub($newQuantity, $reserved, self::SCALE);

                if (bccomp($availableAfter, '0', self::SCALE) < 0) {
                    throw new InsufficientStock(
                        $branchId,
                        $stockItemId,
                        bcsub($currentQuantity, $reserved, self::SCALE),
                        bcmul($delta, '-1', self::SCALE),
                        $reserved,
                    );
                }
            } elseif (bccomp($delta, '0', self::SCALE) < 0 && bccomp($newQuantity, '0', self::SCALE) < 0) {
                throw new InsufficientStock(
                    $branchId,
                    $stockItemId,
                    $currentQuantity,
                    bcmul($delta, '-1', self::SCALE),
                    message: 'There is not that much on the shelf. Record a count first if the shelf holds more than the ledger says.',
                );
            }

            $level->quantity = $newQuantity;
            $level->save();

            /*
             * Stock rose, so a gap that was short of it may close now. Retried by the system rather
             * than left for somebody to notice and press Retry. After the commit, so a receipt that
             * rolls back retries nothing and the sweep reads the stock it was told about.
             */
            if (bccomp($delta, '0', self::SCALE) > 0) {
                DB::afterCommit(static function () use ($organisationId): void {
                    RetryOpenConsumptionExceptions::queueFor($organisationId);
                });
            }

            return StockMovement::query()->create([
                'organisation_id' => $organisationId,
                'branch_id' => $branchId,
                'stock_item_id' => $stockItemId,
                'quantity_delta' => $delta,
                'reason' => $reason,
                'reference_type' => $referenceType,
                'reference_id' => $referenceId,
                'order_line_id' => $orderLineId,
                'sold_item_type' => $soldItemType,
                'notes' => $notes,
                'waste_reason' => $wasteReason,
                'unit_cost_amount' => $unitCostAmount,
                'cost_amount' => $costAmount,
                'cost_currency_code' => $costCurrencyCode,
                // Here because this is the one path, so nothing can forget it. Null
                // for a job with nobody signed in.
                'actor_user_id' => $this->context->userId(),
            ]);
        });
    }

    /**
     * Food thrown away, valued as a confirmed order values what it eats, so the
     * month's waste has a figure and the basis comes down with the shelf. Left
     * unvalued, never free, when no cost is held.
     *
     * @param  numeric-string  $quantity  positive; the ledger records it negative
     * @param  string  $reason  one of {@see self::WASTE_REASONS}; the controller requires a note for `other`
     *
     * @throws InsufficientStock when it would take more than is on hand
     */
    public function recordWaste(string $organisationId, string $branchId, string $stockItemId, string $quantity, ?string $notes, string $reason): StockMovement
    {
        if (! in_array($reason, self::WASTE_REASONS, true)) {
            throw new RuntimeException("Unknown waste reason [{$reason}].");
        }

        $figures = $this->valueShelf($organisationId, $stockItemId, $quantity);

        return DB::transaction(function () use ($organisationId, $branchId, $stockItemId, $quantity, $notes, $reason, $figures): StockMovement {
            $movement = $this->recordMovement(
                $organisationId,
                $branchId,
                $stockItemId,
                'waste',
                '-'.$quantity,
                notes: $notes,
                unitCostAmount: $figures['unit_cost_amount'] ?? null,
                costAmount: $figures['cost_amount'] ?? null,
                costCurrencyCode: $figures['currency_code'] ?? null,
                wasteReason: $reason,
            );

            if ($figures !== null) {
                $this->valuation->lowerBasis($figures['cost_id'], $figures['quantity_in_cost_unit']);
            }

            return $movement;
        });
    }

    /**
     * Records a stock count: the kitchen states what the shelf holds and the
     * ledger takes the difference as an `adjust`.
     *
     * The difference is taken under the same row lock the movement writes
     * under, so a sale landing between the count being typed and posted cannot
     * make it wrong — the shelf ends on the counted figure either way. A count
     * that matches the ledger still posts, as a zero movement: "counted, and it
     * agreed" is a stock-take worth keeping.
     *
     * The difference is valued at the ingredient's moving average, as waste is:
     * a loss lowers the basis, a gain raises it at the same average (found stock
     * came in at no new price). With no cost held the movement is unvalued, never
     * free. A count to zero is how a shelf is emptied before a duplicate merge,
     * so it must carry its value.
     *
     * @param  string  $countedQuantity  what is on the shelf, never negative
     */
    public function recordCount(
        string $organisationId,
        string $branchId,
        string $stockItemId,
        string $countedQuantity,
        ?string $notes = null,
    ): StockMovement {
        $counted = $this->numeric($countedQuantity);

        if (bccomp($counted, '0', self::SCALE) < 0) {
            throw new RuntimeException("A stock count cannot be negative [{$counted}].");
        }

        return DB::transaction(function () use ($organisationId, $branchId, $stockItemId, $counted, $notes): StockMovement {
            $level = $this->lockLevel($organisationId, $branchId, $stockItemId);
            $delta = bcsub($counted, $this->numeric((string) $level->quantity), self::SCALE);
            $direction = bccomp($delta, '0', self::SCALE);
            $figures = $direction === 0 ? null : $this->valueShelf($organisationId, $stockItemId, $direction < 0 ? bcmul($delta, '-1', self::SCALE) : $delta);

            $movement = $this->recordMovement(
                $organisationId,
                $branchId,
                $stockItemId,
                'adjust',
                $delta,
                notes: $notes ?? 'Stock count',
                unitCostAmount: $figures['unit_cost_amount'] ?? null,
                costAmount: $figures['cost_amount'] ?? null,
                costCurrencyCode: $figures['currency_code'] ?? null,
            );

            if ($figures !== null && $direction < 0) {
                $this->valuation->lowerBasis($figures['cost_id'], $figures['quantity_in_cost_unit']);
            } elseif ($figures !== null) {
                $this->valuation->raiseBasis($figures['cost_id'], $figures['quantity_in_cost_unit']);
            }

            return $movement;
        });
    }

    /**
     * Sets — or clears — the reorder threshold, and the par level when one is
     * given, for one (branch, stock item) pair (INV1.3), and audits it.
     *
     * The level row is created if the item has never moved at the branch, so a
     * manager can set a threshold before the first receipt. A null threshold
     * clears it, which the low-stock computation reads as *never low*.
     *
     * @param  numeric-string|null  $reorderThreshold
     * @param  bool  $parGiven  whether the caller stated a par level at all; when not, the stored one stands and is what the threshold is checked against
     * @param  numeric-string|null  $parLevel
     *
     * @throws ValidationException when par does not sit above the threshold
     */
    public function setThreshold(
        string $organisationId,
        string $branchId,
        string $stockItemId,
        ?string $reorderThreshold,
        bool $parGiven,
        ?string $parLevel,
        ?string $actorUserId,
    ): StockLevel {
        $level = StockLevel::query()->firstOrNew(
            ['branch_id' => $branchId, 'stock_item_id' => $stockItemId],
            ['organisation_id' => $organisationId, 'quantity' => '0'],
        );

        $level->reorder_threshold = $reorderThreshold;
        if ($parGiven) {
            $level->par_level = $parLevel;
        }

        // Par is what a supply order restocks to, so it must sit above the point
        // that raised the alarm — restocking to the threshold itself leaves the
        // shelf low again the moment it is booked in. Checked against the stored
        // par when the caller leaves it out; the CHECK on the table backs it.
        $par = is_numeric($level->par_level) ? (string) $level->par_level : null;
        if ($reorderThreshold !== null && $par !== null && bccomp($par, $reorderThreshold, 4) <= 0) {
            throw ValidationException::withMessages([
                'par_level' => 'The restock level must be above the reorder threshold.',
            ]);
        }

        $level->save();

        $this->audit->record(
            'inventory.threshold_set',
            actorUserId: $actorUserId,
            subjectType: 'stock_level',
            subjectId: (string) $level->getKey(),
            metadata: [
                'branch_id' => $level->branch_id,
                'stock_item_id' => $level->stock_item_id,
                'reorder_threshold' => $reorderThreshold,
                'par_level' => $par,
            ],
        );

        return $level;
    }

    /**
     * Whether a level is low: it has a threshold set and its quantity has
     * reached or fallen below it (INV1.3).
     *
     * Computed, never stored — the same live read as {@see isOutOfStock()} on
     * the client (`ops-format.ts`). A null threshold is "no threshold set",
     * which is *never low* rather than low-at-zero: a kitchen that has not asked
     * to be warned about an item is not warned. The comparison is bccomp on the
     * decimal strings so `10.0000 <= 10` is exact rather than a float's
     * near-miss, and the boundary is inclusive — quantity equal to the threshold
     * is already low, because that is the moment to reorder.
     *
     * @param  numeric-string|null  $reorderThreshold
     * @param  numeric-string  $quantity
     */
    public static function isLowStock(?string $reorderThreshold, string $quantity): bool
    {
        if ($reorderThreshold === null) {
            return false;
        }

        return bccomp($quantity, $reorderThreshold, self::SCALE) <= 0;
    }

    /**
     * A quantity of the shelf's item valued at its ingredient's moving average,
     * or null when it cannot be: no ingredient, no unit, no cost held, or units
     * that will not convert.
     *
     * @param  numeric-string  $quantity  positive, in the shelf's unit
     * @return array{unit_cost_amount: numeric-string, cost_amount: numeric-string, currency_code: string, cost_id: string, quantity_in_cost_unit: numeric-string}|null
     */
    private function valueShelf(string $organisationId, string $stockItemId, string $quantity): ?array
    {
        $item = StockItem::withoutTenancy()->where('organisation_id', $organisationId)->whereKey($stockItemId)->first();
        $unit = $item?->unit_id === null ? null : MeasurementUnit::query()->find($item->unit_id);

        $valued = $item?->ingredient_id !== null && $unit instanceof MeasurementUnit
            ? $this->valuation->value($organisationId, $item->ingredient_id, $unit, $quantity)
            : null;

        return is_array($valued) ? $valued : null;
    }

    /**
     * The level row, created if this is the item's first movement at the
     * branch, then re-read under a row lock for the read-modify-write.
     */
    private function lockLevel(string $organisationId, string $branchId, string $stockItemId): StockLevel
    {
        StockLevel::query()->firstOrCreate(
            ['branch_id' => $branchId, 'stock_item_id' => $stockItemId],
            ['organisation_id' => $organisationId, 'quantity' => '0'],
        );

        return StockLevel::query()
            ->where('branch_id', $branchId)
            ->where('stock_item_id', $stockItemId)
            ->lockForUpdate()
            ->firstOrFail();
    }

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring,
     * which would turn a malformed delta into a silent no-op movement. This
     * guard makes that a loud failure instead.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Inventory movement received a non-numeric quantity [{$value}].");
        }

        return $value;
    }
}
