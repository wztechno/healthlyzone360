<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Posting a goods receipt — and, since INV1.1, everything that costs (the whole
 * point of the feature on the input side).
 *
 * One transaction does three things per line:
 *
 * 1. **Records the line**, with what was paid — unit price, line total and
 *    currency — kept on the procurement side where a landed cost belongs
 *    (never on the order, which `OrderArchitectureTest` guards).
 * 2. **Raises stock.** The purchased quantity is converted from the unit the
 *    price is quoted in into the stock item's own unit (`UnitConversionService`,
 *    which refuses across dimensions rather than inventing a density) and a
 *    `receipt` movement is recorded through the locked `InventoryService`.
 * 3. **Blends the cost.** When the stock item is backed by an ingredient and
 *    the line carries a price, the purchase is folded into that ingredient's
 *    weighted moving-average cost (`IngredientCostService`). A line whose stock
 *    item has no ingredient — packaging, cleaning supplies — raises stock and
 *    records nothing to cost, and that is correct rather than a gap: there is
 *    no ingredient whose average it could move.
 *
 * The whole post is audited once, with counts and identifiers only — never an
 * amount, which would put the cost surface behind `audit.view_organisation`
 * instead of `inventory.view_costs_organisation`.
 */
final readonly class GoodsReceiptService
{
    public function __construct(
        private InventoryService $inventory,
        private IngredientCostService $costing,
        private UnitConversionService $conversion,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @param  list<array{stock_item_id: string, quantity: float|string, unit_id?: string|null, unit_price_amount?: float|string|null, cost_currency_code?: string|null}>  $lines
     */
    public function post(
        string $organisationId,
        string $branchId,
        ?string $supplierId,
        ?string $documentRef,
        ?string $purchaseOrderId,
        array $lines,
    ): GoodsReceipt {
        return DB::transaction(function () use ($organisationId, $branchId, $supplierId, $documentRef, $purchaseOrderId, $lines): GoodsReceipt {
            $receipt = GoodsReceipt::query()->create([
                'organisation_id' => $organisationId,
                'branch_id' => $branchId,
                'supplier_id' => $supplierId,
                'document_ref' => $documentRef,
                'purchase_order_id' => $purchaseOrderId,
                'received_at' => now(),
            ]);

            $costedLineCount = 0;

            foreach ($lines as $line) {
                $quantity = $this->numeric((string) $line['quantity']);
                $unitId = $line['unit_id'] ?? null;
                // `isset` is already false for a null value, so an explicit
                // null check beside it would always be true.
                $unitPrice = isset($line['unit_price_amount'])
                    ? $this->numeric((string) $line['unit_price_amount'])
                    : null;
                $currencyCode = $line['cost_currency_code'] ?? null;

                $lineTotal = $unitPrice === null ? null : $this->round(bcmul($quantity, $unitPrice, 12));

                $stockItem = StockItem::query()->findOrFail($line['stock_item_id']);

                $record = GoodsReceiptLine::query()->create([
                    'goods_receipt_id' => $receipt->getKey(),
                    'stock_item_id' => $line['stock_item_id'],
                    'quantity' => $quantity,
                    'unit_id' => $unitId,
                    'unit_price_amount' => $unitPrice,
                    'line_total_amount' => $lineTotal,
                    'cost_currency_code' => $unitPrice === null ? null : $currencyCode,
                ]);

                $this->raiseStock($organisationId, $branchId, $stockItem, $quantity, $unitId, (string) $receipt->getKey());

                if ($unitPrice !== null && $currencyCode !== null && $stockItem->ingredient_id !== null) {
                    $purchaseUnit = $this->purchaseUnit($unitId, $stockItem);

                    if ($purchaseUnit !== null) {
                        /** @var Ingredient $ingredient */
                        $ingredient = Ingredient::withoutTenancy()->findOrFail($stockItem->ingredient_id);

                        $this->costing->recordPurchase(
                            $organisationId,
                            $ingredient,
                            $quantity,
                            $purchaseUnit,
                            $unitPrice,
                            $currencyCode,
                            (string) $record->getKey(),
                        );

                        $costedLineCount++;
                    }
                }
            }

            $this->audit->record(
                'procurement.goods_receipt_posted',
                actorUserId: $this->context->userId(),
                subjectType: 'goods_receipt',
                subjectId: (string) $receipt->getKey(),
                // Identifiers and counts only — never an amount. An audit row is
                // readable with `audit.view_organisation`, which is not the cost
                // permission, so a figure here would route around the gate.
                metadata: [
                    'branch_id' => $branchId,
                    'supplier_id' => $supplierId,
                    'line_count' => count($lines),
                    'costed_line_count' => $costedLineCount,
                ],
            );

            return $receipt;
        });
    }

    /**
     * Convert the purchased quantity into the stock item's own unit and record
     * the receipt movement. When either unit is unknown the quantity is taken
     * as already in stock units — the honest fallback for a stock item INV1.0
     * left without a resolved `unit_id`.
     *
     * @param  numeric-string  $quantity
     */
    private function raiseStock(
        string $organisationId,
        string $branchId,
        StockItem $stockItem,
        string $quantity,
        ?string $purchaseUnitId,
        string $receiptId,
    ): void {
        $stockQuantity = $quantity;

        $purchaseUnit = $purchaseUnitId === null ? null : MeasurementUnit::query()->find($purchaseUnitId);
        $stockUnit = $stockItem->unit_id === null ? null : MeasurementUnit::query()->find($stockItem->unit_id);

        if ($purchaseUnit instanceof MeasurementUnit && $stockUnit instanceof MeasurementUnit) {
            $stockQuantity = $this->conversion->convert($quantity, $purchaseUnit, $stockUnit);
        }

        $this->inventory->recordMovement(
            $organisationId,
            $branchId,
            (string) $stockItem->getKey(),
            'receipt',
            $stockQuantity,
            'goods_receipt',
            $receiptId,
        );
    }

    /**
     * The unit a priced line's price is quoted in — the line's own `unit_id`,
     * falling back to the stock item's unit when the line did not state one.
     */
    private function purchaseUnit(?string $unitId, StockItem $stockItem): ?MeasurementUnit
    {
        $resolved = $unitId ?? $stockItem->unit_id;

        return $resolved === null ? null : MeasurementUnit::query()->find($resolved);
    }

    /**
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-0.0000005' : '0.0000005', 6);
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Goods receipt received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
