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

    /**
     * @param  string  $quantityDelta  a signed decimal string; negative removes stock. Narrowed to a numeric-string by {@see numeric()} before any arithmetic.
     *
     * @throws InsufficientStock when a consume would drive the level below zero
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
    ): StockMovement {
        $delta = $this->numeric($quantityDelta);

        return DB::transaction(function () use ($organisationId, $branchId, $stockItemId, $reason, $delta, $referenceType, $referenceId, $notes): StockMovement {
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

            if ($reason === 'consume' && bccomp($newQuantity, '0', self::SCALE) < 0) {
                throw new InsufficientStock(
                    $branchId,
                    $stockItemId,
                    $currentQuantity,
                    bcmul($delta, '-1', self::SCALE),
                );
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
                'notes' => $notes,
            ]);
        });
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
