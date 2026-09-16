<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Exceptions\InsufficientStock;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Illuminate\Support\Facades\DB;
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
 * 2. **A consume cannot go negative.** Taking more off the shelf than was ever
 *    on it is not a correction, it is a wrong number that would later be valued
 *    as COGS, so it is refused with `inventory.insufficient_stock`. `adjust` and
 *    `waste` are exempt: those are explicit human corrections that a real
 *    negative count legitimately produces.
 */
final readonly class InventoryService
{
    /**
     * Working precision for the balance. Six places matches the costing layer;
     * the column stores four and rounds the last two away on write.
     */
    private const int SCALE = 6;

    public function __construct(private ReservationService $reservations) {}

    /**
     * @param  string  $quantityDelta  a signed decimal string; negative removes stock. Narrowed to a numeric-string by {@see numeric()} before any arithmetic.
     * @param  numeric-string|null  $unitCostAmount  the moving-average cost this movement is valued at, per the ingredient default unit — set only by the consume path (INV1.2), which captures COGS here because the order tables may not
     * @param  numeric-string|null  $costAmount  this movement's COGS: unit cost × quantity consumed
     * @param  string|null  $costCurrencyCode  required when either cost amount is given (the CHECK on the column enforces it)
     * @param  string|null  $orderLineId  the order line a consume served, so COGS attributes per line and kind (INV1.5); null on every non-consume movement
     * @param  string|null  $soldItemType  `meal` or `product`, denormalised from the sold catalogue item so the report splits COGS by line of business without a join (INV1.5)
     * @param  string|null  $holderType  the claim this movement consumes against, so a batch is checked against everyone else's reservations rather than its own (PROD1)
     * @param  string|null  $holderId  the holder id, paired with `$holderType`; both or neither
     *
     * @throws InsufficientStock when a consume would drive available stock below zero
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
    ): StockMovement {
        $delta = $this->numeric($quantityDelta);

        return DB::transaction(function () use ($organisationId, $branchId, $stockItemId, $reason, $delta, $referenceType, $referenceId, $notes, $unitCostAmount, $costAmount, $costCurrencyCode, $orderLineId, $soldItemType, $holderType, $holderId): StockMovement {
            // Establish the row if this is the item's first movement at the
            // branch, then take a row lock for the read-modify-write itself.
            StockLevel::query()->firstOrCreate(
                ['branch_id' => $branchId, 'stock_item_id' => $stockItemId],
                ['organisation_id' => $organisationId, 'quantity' => '0'],
            );

            $level = StockLevel::query()
                ->where('branch_id', $branchId)
                ->where('stock_item_id', $stockItemId)
                ->lockForUpdate()
                ->firstOrFail();

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
             * `adjust` and `waste` stay exempt, unchanged and deliberately. A
             * stock count that comes up short is a fact; refusing to record it
             * would hide the discrepancy rather than surface it. It can therefore
             * leave a confirmed batch short, and
             * {@see ReservationService::isShort()} is how that is reported rather
             * than prevented.
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
            }

            $level->quantity = $newQuantity;
            $level->save();

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
                'unit_cost_amount' => $unitCostAmount,
                'cost_amount' => $costAmount,
                'cost_currency_code' => $costCurrencyCode,
            ]);
        });
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
