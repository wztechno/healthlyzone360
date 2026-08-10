import { BranchId, OrderId, UserId } from '@healthy360/domain-types';
import type { ProductionOrderId, QualityCheckId, StockItemId } from '@healthy360/domain-types';

import { apiFailure, throwFailure, validationFailure } from '../../contracts/failure.ts';
import type {
    CompleteProductionOrderRequest,
    ConsumptionException,
    ConsumptionExceptionFilter,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateStockItemRequest,
    GoodsReceipt,
    GoodsReceiptResult,
    MonthlyCostReportFilter,
    MonthlyCostReportRow,
    PostGoodsReceiptRequest,
    ProductionOrder,
    ProductionOrderResult,
    PurchaseLedgerFilter,
    PurchaseLedgerLine,
    QualityCheck,
    QualityCheckResult,
    ResolveConsumptionExceptionRequest,
    SetStockThresholdRequest,
    StockAdjustmentRequest,
    StockItem,
    StockLevel,
    StockMovement,
    StockWasteRequest,
    Supplier,
    SupplierRef,
} from '../../contracts/kitchen-ops.ts';
import type { CursorPage } from '../../contracts/pagination.ts';
import {
    KITCHEN_OPS_RUNTIME_ORDINAL_START,
    goodsReceiptIdAt,
    productionOrderIdAt,
    qualityCheckIdAt,
    stockItemIdAt,
    supplierIdAt,
} from './ids.ts';

/** The single branch every seed row belongs to — see the module header for why that is safe. */
const SEED_BRANCH_ID = BranchId.unsafe('01935f6d-0000-7000-8000-0000000000f1');

/**
 * The mock's copy of `InventoryService::isLowStock` (INV1.3): a level is low when a threshold is
 * set and its quantity has reached or fallen to or below it. `null` threshold is never low. Numeric
 * comparison here rather than bcmath — the mock quantities are small and exact — but the boundary is
 * the same inclusive `<=` the backend enforces.
 */
function computeIsLow(quantity: string, reorderThreshold: string | null): boolean {
    if (reorderThreshold === null) {
        return false;
    }
    return Number(quantity) <= Number(reorderThreshold);
}

/**
 * The kitchen ops fixture world (O1–O4).
 *
 * A flat, self-contained mock over five arrays — nothing here reads the foundation account world
 * or the K1 prototype catalogue, on purpose. `listStockLevels` is **not** filtered by an active
 * branch the way the real endpoint is: this module has no transport and no `X-Branch-Id`, so a
 * screen exercising the mock sees every level that exists rather than one scoped to whichever
 * branch the signed-in fixture happens to hold. That is an accepted simplification for a UI
 * development and unit-test double, stated once here rather than discovered as a surprise in a
 * failing assertion.
 *
 * Every write validates the same "adjust the ledger" arithmetic the real `InventoryService` does,
 * so a screen exercising the mock is exercising the same signed-delta rule the backend enforces.
 */
export class KitchenOpsMockStore {
    #stockItems: StockItem[] = [
        {
            id: stockItemIdAt(1),
            code: 'FLR-001',
            nameEn: 'All-purpose flour',
            unitCode: 'kg',
            ingredientId: null,
        },
        {
            id: stockItemIdAt(2),
            code: 'OIL-002',
            nameEn: 'Olive oil',
            unitCode: 'l',
            ingredientId: null,
        },
        {
            id: stockItemIdAt(3),
            code: 'PKG-010',
            nameEn: 'Takeaway boxes',
            unitCode: 'pcs',
            ingredientId: null,
        },
        {
            id: stockItemIdAt(4),
            code: 'CHK-020',
            nameEn: 'Chicken breast',
            unitCode: 'kg',
            ingredientId: null,
        },
    ];

    #stockLevels: StockLevel[] = [
        {
            id: 'level-1',
            branchId: SEED_BRANCH_ID,
            stockItemId: stockItemIdAt(1),
            quantity: '42.500',
            reorderThreshold: '10.000',
            parLevel: '50.000',
            isLow: false,
            itemCode: 'FLR-001',
            itemNameEn: 'All-purpose flour',
            ingredientId: null,
        },
        {
            id: 'level-2',
            branchId: SEED_BRANCH_ID,
            stockItemId: stockItemIdAt(2),
            quantity: '18.000',
            reorderThreshold: null,
            parLevel: null,
            isLow: false,
            itemCode: 'OIL-002',
            itemNameEn: 'Olive oil',
            ingredientId: null,
        },
        {
            // Seeded below its threshold (9.75 <= 15) so mock mode shows the low-stock flag on the
            // stock screen and a count of 1 on the hub badge without any interaction (INV1.3).
            id: 'level-3',
            branchId: SEED_BRANCH_ID,
            stockItemId: stockItemIdAt(4),
            quantity: '9.750',
            reorderThreshold: '15.000',
            parLevel: '40.000',
            isLow: true,
            itemCode: 'CHK-020',
            itemNameEn: 'Chicken breast',
            ingredientId: null,
        },
    ];

    #movements: StockMovement[] = [];

    #suppliers: Supplier[] = [
        {
            id: supplierIdAt(1),
            code: 'SUP-001',
            nameEn: 'Gulf Fresh Produce',
            currencyCode: 'USD',
            contactEmail: 'orders@gulffresh.example',
            contactPhone: null,
        },
        {
            id: supplierIdAt(2),
            code: 'SUP-002',
            nameEn: 'Al Waha Meats',
            currencyCode: 'USD',
            contactEmail: null,
            contactPhone: null,
        },
    ];

    #goodsReceipts: GoodsReceipt[] = [
        {
            id: goodsReceiptIdAt(1),
            branchId: SEED_BRANCH_ID,
            supplier: { id: supplierIdAt(1), code: 'SUP-001', nameEn: 'Gulf Fresh Produce' },
            documentRef: 'DN-1001',
            purchaseOrderId: null,
            receivedAt: '2026-08-01T09:00:00.000Z',
            currencyCode: 'USD',
            receiptTotalAmount: '50.000000',
            costsRedacted: false,
            lines: [
                {
                    stockItemId: stockItemIdAt(1),
                    quantity: '25.000',
                    unitId: 'unit-kg',
                    unitPriceAmount: '2.000000',
                    lineTotalAmount: '50.000000',
                    costCurrencyCode: 'USD',
                },
            ],
        },
    ];

    /**
     * The monthly cost report fixture (INV1.4) — two months so the screen renders spend, COGS,
     * revenue, margin and the meal-versus-product split without any interaction, and the earlier
     * month carries a data-quality flag (an unresolved consumption exception understated its COGS)
     * so the honest-incomplete state is visible in mock mode too. Every amount is a major-unit
     * decimal string in one currency; nothing here is summed across currencies.
     */
    #costReport: MonthlyCostReportRow[] = [
        {
            month: '2026-08',
            currencyCode: 'USD',
            spendAmount: '1850.000000',
            cogsAmount: '1420.000000',
            wasteAmount: '65.000000',
            wasteQuantity: '12.500000',
            revenueAmount: '3120.000000',
            grossMarginAmount: '1700.000000',
            grossMarginPercent: '54.49',
            mealRevenueAmount: '2340.000000',
            productRevenueAmount: '620.000000',
            otherRevenueAmount: '160.000000',
            mealCogsAmount: '1100.000000',
            productCogsAmount: '260.000000',
            otherCogsAmount: '60.000000',
            hasDataQualityFlag: false,
            exceptionCount: 0,
        },
        {
            month: '2026-07',
            currencyCode: 'USD',
            spendAmount: '1615.000000',
            cogsAmount: '1180.000000',
            wasteAmount: null,
            wasteQuantity: '8.000000',
            revenueAmount: '2680.000000',
            grossMarginAmount: '1500.000000',
            grossMarginPercent: '55.97',
            mealRevenueAmount: '1980.000000',
            productRevenueAmount: '540.000000',
            otherRevenueAmount: '160.000000',
            mealCogsAmount: '900.000000',
            productCogsAmount: '220.000000',
            otherCogsAmount: '60.000000',
            hasDataQualityFlag: true,
            exceptionCount: 2,
        },
    ];

    /**
     * The consumption-exception fixture (INV1.5) — two still-open and one already resolved, so the
     * review screen renders the open queue, the resolved-filter view and the badge count without any
     * interaction. Soft references carry human-readable names the way the real presenter joins them.
     */
    #consumptionExceptions: ConsumptionException[] = [
        {
            id: 'exc-1',
            orderId: OrderId.unsafe('01935f6d-1000-7000-8000-0000000000a1'),
            orderNumber: 'ORD-2043',
            orderLineId: '01935f6d-1000-7000-8000-0000000000b1',
            catalogueItemId: '01935f6d-1000-7000-8000-0000000000c1',
            itemNameEn: 'Grilled chicken bowl',
            branchId: SEED_BRANCH_ID,
            branchName: 'Downtown kitchen',
            reasonCode: 'no_stock_item',
            detail: 'Ingredient 01935f6d-…-e1 has no stock item at the branch to deduct from.',
            resolved: false,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: '2026-08-08T11:20:00.000Z',
        },
        {
            id: 'exc-2',
            orderId: OrderId.unsafe('01935f6d-1000-7000-8000-0000000000a2'),
            orderNumber: 'ORD-2051',
            orderLineId: '01935f6d-1000-7000-8000-0000000000b2',
            catalogueItemId: '01935f6d-1000-7000-8000-0000000000c2',
            itemNameEn: 'Cold-pressed orange juice',
            branchId: SEED_BRANCH_ID,
            branchName: 'Downtown kitchen',
            reasonCode: 'insufficient_stock',
            detail: 'Ingredient 01935f6d-…-e2: not enough stock to deduct 6.000000.',
            resolved: false,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: '2026-08-09T09:05:00.000Z',
        },
        {
            id: 'exc-3',
            orderId: OrderId.unsafe('01935f6d-1000-7000-8000-0000000000a3'),
            orderNumber: 'ORD-2038',
            orderLineId: '01935f6d-1000-7000-8000-0000000000b3',
            catalogueItemId: '01935f6d-1000-7000-8000-0000000000c3',
            itemNameEn: 'Quinoa salad',
            branchId: SEED_BRANCH_ID,
            branchName: 'Downtown kitchen',
            reasonCode: 'no_ingredient_cost',
            detail: 'Stock deducted, but no moving-average cost exists for the ingredient, so COGS is unvalued.',
            resolved: true,
            resolvedAt: '2026-08-07T14:00:00.000Z',
            resolvedBy: UserId.unsafe('01935f6d-1000-7000-8000-0000000000d1'),
            resolutionNote: 'Cost backfilled from the supplier invoice; accepting the gap on this order.',
            createdAt: '2026-08-06T16:30:00.000Z',
        },
    ];

    #productionOrders: ProductionOrder[] = [];
    #qualityChecks: QualityCheck[] = [];

    #stockItemOrdinal = KITCHEN_OPS_RUNTIME_ORDINAL_START;
    #goodsReceiptOrdinal = KITCHEN_OPS_RUNTIME_ORDINAL_START;
    #productionOrderOrdinal = KITCHEN_OPS_RUNTIME_ORDINAL_START;
    #qualityCheckOrdinal = KITCHEN_OPS_RUNTIME_ORDINAL_START;
    #movementOrdinal = 1;

    stockItems(): readonly StockItem[] {
        return [...this.#stockItems];
    }

    createStockItem(request: CreateStockItemRequest): StockItem {
        if (this.#stockItems.some((item) => item.code === request.code)) {
            throwFailure(validationFailure({ code: ['This code is already in use.'] }));
        }

        const item: StockItem = {
            id: stockItemIdAt(this.#stockItemOrdinal++),
            code: request.code,
            nameEn: request.nameEn,
            unitCode: request.unitCode ?? 'kg',
            ingredientId: request.ingredientId ?? null,
        };
        this.#stockItems.push(item);
        return item;
    }

    stockLevels(): readonly StockLevel[] {
        return [...this.#stockLevels];
    }

    #findStockItem(stockItemId: StockItemId): StockItem {
        const item = this.#stockItems.find((candidate) => candidate.id === stockItemId);
        if (item === undefined) throwFailure(apiFailure('resource.not_found'));
        return item;
    }

    #applyMovement(
        branchId: BranchId,
        stockItemId: StockItemId,
        delta: number,
        reason: StockMovement['reason'],
    ): StockMovement {
        const item = this.#findStockItem(stockItemId);
        let level = this.#stockLevels.find(
            (candidate) => candidate.branchId === branchId && candidate.stockItemId === stockItemId,
        );

        if (level === undefined) {
            level = {
                id: `level-${String(this.#stockLevels.length + 1)}`,
                branchId,
                stockItemId,
                quantity: '0.000',
                reorderThreshold: null,
                parLevel: null,
                isLow: false,
                itemCode: item.code,
                itemNameEn: item.nameEn,
                ingredientId: item.ingredientId,
            };
            this.#stockLevels.push(level);
        }

        const nextQuantity = (Number(level.quantity) + delta).toFixed(3);
        const levelId = level.id;
        this.#stockLevels = this.#stockLevels.map((candidate) =>
            candidate.id === levelId
                ? {
                      ...candidate,
                      quantity: nextQuantity,
                      isLow: computeIsLow(nextQuantity, candidate.reorderThreshold),
                  }
                : candidate,
        );

        const movement: StockMovement = {
            id: `movement-${String(this.#movementOrdinal++)}`,
            quantityDelta: delta >= 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3),
            reason,
        };
        this.#movements.push(movement);
        return movement;
    }

    recordAdjustment(request: StockAdjustmentRequest): StockMovement {
        return this.#applyMovement(
            request.branchId,
            request.stockItemId,
            request.quantityDelta,
            'adjust',
        );
    }

    recordWaste(request: StockWasteRequest): StockMovement {
        if (request.quantity <= 0) {
            throwFailure(validationFailure({ quantity: ['Quantity must be greater than zero.'] }));
        }
        return this.#applyMovement(
            request.branchId,
            request.stockItemId,
            -Math.abs(request.quantity),
            'waste',
        );
    }

    /**
     * Sets or clears a level's reorder threshold (INV1.3). Creates the level at quantity zero if the
     * item has never moved at this branch — the same `firstOrCreate` the backend does — so a
     * threshold can be set before the first receipt. `isLow` is recomputed against the new threshold.
     */
    setThreshold(request: SetStockThresholdRequest): StockLevel {
        const item = this.#findStockItem(request.stockItemId);
        let level = this.#stockLevels.find(
            (candidate) =>
                candidate.branchId === request.branchId &&
                candidate.stockItemId === request.stockItemId,
        );

        if (level === undefined) {
            level = {
                id: `level-${String(this.#stockLevels.length + 1)}`,
                branchId: request.branchId,
                stockItemId: request.stockItemId,
                quantity: '0.000',
                reorderThreshold: null,
                parLevel: null,
                isLow: false,
                itemCode: item.code,
                itemNameEn: item.nameEn,
                ingredientId: item.ingredientId,
            };
            this.#stockLevels.push(level);
        }

        const reorderThreshold =
            request.reorderThreshold === null ? null : request.reorderThreshold.toFixed(3);
        const parLevel =
            request.parLevel === undefined
                ? level.parLevel
                : request.parLevel === null
                  ? null
                  : request.parLevel.toFixed(3);

        const updated: StockLevel = {
            ...level,
            reorderThreshold,
            parLevel,
            isLow: computeIsLow(level.quantity, reorderThreshold),
        };
        const levelId = level.id;
        this.#stockLevels = this.#stockLevels.map((candidate) =>
            candidate.id === levelId ? updated : candidate,
        );
        return updated;
    }

    /** How many levels are low right now — the count the hub badge reads. */
    lowStockCount(): number {
        return this.#stockLevels.filter((level) => level.isLow).length;
    }

    suppliers(): readonly Supplier[] {
        return [...this.#suppliers];
    }

    goodsReceipts(): readonly GoodsReceipt[] {
        return [...this.#goodsReceipts]
            .sort((left, right) => (right.receivedAt ?? '').localeCompare(left.receivedAt ?? ''))
            .slice(0, 50);
    }

    postGoodsReceipt(request: PostGoodsReceiptRequest): GoodsReceiptResult {
        if (request.lines.length === 0) {
            throwFailure(validationFailure({ lines: ['At least one line is required.'] }));
        }

        for (const line of request.lines) {
            this.#applyMovement(request.branchId, line.stockItemId, line.quantity, 'receipt');
        }

        const lines = request.lines.map((line) => {
            const priced =
                line.unitPriceAmount !== undefined && line.unitPriceAmount !== null;
            const lineTotal = priced ? line.quantity * (line.unitPriceAmount ?? 0) : null;
            return {
                stockItemId: line.stockItemId,
                quantity: line.quantity.toFixed(3),
                unitId: line.unitId ?? null,
                unitPriceAmount: priced ? (line.unitPriceAmount ?? 0).toFixed(6) : null,
                lineTotalAmount: lineTotal === null ? null : lineTotal.toFixed(6),
                costCurrencyCode: priced ? (line.costCurrencyCode ?? null) : null,
            };
        });

        const currencies = new Set(
            lines
                .map((line) => line.costCurrencyCode)
                .filter((code): code is string => code !== null),
        );
        const currencyCode = currencies.size === 1 ? ([...currencies][0] ?? null) : null;
        const total =
            currencyCode === null
                ? null
                : lines
                      .filter((line) => line.costCurrencyCode === currencyCode)
                      .reduce((sum, line) => sum + Number(line.lineTotalAmount ?? 0), 0)
                      .toFixed(6);

        const supplier =
            request.supplierId === undefined || request.supplierId === null
                ? null
                : (this.#suppliers.find((candidate) => candidate.id === request.supplierId) ?? null);

        const receipt: GoodsReceipt = {
            id: goodsReceiptIdAt(this.#goodsReceiptOrdinal++),
            branchId: request.branchId,
            supplier:
                supplier === null
                    ? null
                    : { id: supplier.id, code: supplier.code, nameEn: supplier.nameEn },
            documentRef: request.documentRef ?? null,
            purchaseOrderId: request.purchaseOrderId ?? null,
            receivedAt: new Date().toISOString(),
            currencyCode,
            receiptTotalAmount: total,
            costsRedacted: false,
            lines,
        };
        this.#goodsReceipts.push(receipt);
        return { id: receipt.id };
    }

    /**
     * The purchases ledger (INV1.1) — every receipt line flattened with the date, supplier and item
     * it belongs to, newest first. A single-page mock: the fixture set is small, so it answers the
     * whole filtered list at once with no cursor, which is a legal {@link CursorPage}.
     */
    purchasesLedger(filter: PurchaseLedgerFilter = {}): CursorPage<PurchaseLedgerLine> {
        const items: PurchaseLedgerLine[] = [];

        for (const receipt of [...this.#goodsReceipts].sort((left, right) =>
            (right.receivedAt ?? '').localeCompare(left.receivedAt ?? ''),
        )) {
            if (filter.supplierId !== undefined && receipt.supplier?.id !== filter.supplierId) {
                continue;
            }
            if (filter.from !== undefined && (receipt.receivedAt ?? '') < filter.from) continue;
            if (filter.to !== undefined && (receipt.receivedAt ?? '') > `${filter.to}T23:59:59Z`) {
                continue;
            }

            const supplierRef: SupplierRef | null =
                receipt.supplier === null ? null : receipt.supplier;

            for (const line of receipt.lines) {
                const item = this.#stockItems.find(
                    (candidate) => candidate.id === line.stockItemId,
                );

                if (
                    filter.ingredientId !== undefined &&
                    item?.ingredientId !== filter.ingredientId
                ) {
                    continue;
                }

                items.push({
                    id: `ledger-${String(receipt.id)}-${String(line.stockItemId)}`,
                    goodsReceiptId: receipt.id,
                    receivedAt: receipt.receivedAt,
                    supplier: supplierRef,
                    documentRef: receipt.documentRef,
                    stockItemId: line.stockItemId,
                    itemCode: item?.code ?? null,
                    itemNameEn: item?.nameEn ?? null,
                    ingredientId: item?.ingredientId ?? null,
                    quantity: line.quantity,
                    unitId: line.unitId,
                    unitPriceAmount: line.unitPriceAmount,
                    lineTotalAmount: line.lineTotalAmount,
                    costCurrencyCode: line.costCurrencyCode,
                    costsRedacted: false,
                });
            }
        }

        return { items, nextCursor: null, hasMore: false, totalCount: items.length };
    }

    /**
     * The monthly cost report (INV1.4), newest month first, within the optional inclusive `YYYY-MM`
     * bounds. The fixture is small, so it filters and returns the whole set at once.
     */
    costReport(filter: MonthlyCostReportFilter = {}): readonly MonthlyCostReportRow[] {
        return [...this.#costReport]
            .filter((row) => {
                if (filter.from !== undefined && row.month < filter.from) return false;
                if (filter.to !== undefined && row.month > filter.to) return false;
                return true;
            })
            .sort((left, right) => right.month.localeCompare(left.month));
    }

    /**
     * The consumption-exception review list (INV1.5), newest first, within the optional resolution
     * and date filters. A single-page mock: the fixture set is small, so it answers the whole
     * filtered list at once with no cursor, which is a legal {@link CursorPage}.
     */
    consumptionExceptions(filter: ConsumptionExceptionFilter = {}): CursorPage<ConsumptionException> {
        const items = [...this.#consumptionExceptions]
            .filter((exception) => {
                if (filter.resolved !== undefined && exception.resolved !== filter.resolved) {
                    return false;
                }
                if (filter.from !== undefined && (exception.createdAt ?? '') < filter.from) return false;
                if (
                    filter.to !== undefined &&
                    (exception.createdAt ?? '') > `${filter.to}T23:59:59Z`
                ) {
                    return false;
                }
                return true;
            })
            .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));

        return { items, nextCursor: null, hasMore: false, totalCount: items.length };
    }

    /** How many exceptions are unresolved right now — the count the hub badge reads. */
    unresolvedConsumptionExceptionCount(): number {
        return this.#consumptionExceptions.filter((exception) => !exception.resolved).length;
    }

    resolveConsumptionException(
        exceptionId: string,
        request: ResolveConsumptionExceptionRequest = {},
    ): ConsumptionException {
        const exception = this.#consumptionExceptions.find(
            (candidate) => candidate.id === exceptionId,
        );
        if (exception === undefined) throwFailure(apiFailure('resource.not_found'));

        // Idempotent — resolving an already-resolved exception leaves it as it stands.
        const updated: ConsumptionException = exception.resolved
            ? exception
            : {
                  ...exception,
                  resolved: true,
                  resolvedAt: new Date().toISOString(),
                  resolvedBy: UserId.unsafe('01935f6d-1000-7000-8000-0000000000d1'),
                  resolutionNote: request.note ?? null,
              };

        this.#consumptionExceptions = this.#consumptionExceptions.map((candidate) =>
            candidate.id === exceptionId ? updated : candidate,
        );
        return updated;
    }

    /**
     * Re-runs the consumption an exception blocks (INV1.5). The mock has no real deduction engine, so
     * it models the happy path a manager who has just fixed the cause expects: the line now consumes
     * cleanly and the exception auto-resolves. An already-resolved one is a no-op. (Simplification
     * stated once here rather than discovered as a surprise: the real backend re-runs the deduction
     * and may leave the exception open if it still cannot resolve.)
     */
    retryConsumptionException(exceptionId: string): ConsumptionException {
        const exception = this.#consumptionExceptions.find(
            (candidate) => candidate.id === exceptionId,
        );
        if (exception === undefined) throwFailure(apiFailure('resource.not_found'));

        const updated: ConsumptionException = exception.resolved
            ? exception
            : {
                  ...exception,
                  resolved: true,
                  resolvedAt: new Date().toISOString(),
                  resolvedBy: UserId.unsafe('01935f6d-1000-7000-8000-0000000000d1'),
                  resolutionNote: 'Auto-resolved on retry: this line now consumes cleanly.',
              };

        this.#consumptionExceptions = this.#consumptionExceptions.map((candidate) =>
            candidate.id === exceptionId ? updated : candidate,
        );
        return updated;
    }

    productionOrders(): readonly ProductionOrder[] {
        return [...this.#productionOrders].slice(0, 50);
    }

    createProductionOrder(request: CreateProductionOrderRequest): ProductionOrderResult {
        const order: ProductionOrder = {
            id: productionOrderIdAt(this.#productionOrderOrdinal++),
            recipeVersionId: request.recipeVersionId,
            status: 'planned',
            branchId: request.branchId,
        };
        this.#productionOrders.unshift(order);
        return { id: order.id, status: order.status };
    }

    completeProductionOrder(
        productionOrderId: ProductionOrderId,
        request: CompleteProductionOrderRequest,
    ): ProductionOrderResult {
        const order = this.#productionOrders.find(
            (candidate) => candidate.id === productionOrderId,
        );
        if (order === undefined) throwFailure(apiFailure('resource.not_found'));

        for (const line of request.consumes ?? []) {
            this.#applyMovement(
                order.branchId,
                line.stockItemId,
                -Math.abs(line.quantity),
                'consume',
            );
        }
        for (const line of request.yields ?? []) {
            this.#applyMovement(order.branchId, line.stockItemId, Math.abs(line.quantity), 'yield');
        }

        this.#productionOrders = this.#productionOrders.map((candidate) =>
            candidate.id === productionOrderId ? { ...candidate, status: 'completed' } : candidate,
        );
        return { id: order.id, status: 'completed' };
    }

    qualityChecks(): readonly QualityCheck[] {
        return [...this.#qualityChecks].slice(0, 50);
    }

    createQualityCheck(request: CreateQualityCheckRequest): QualityCheckResult {
        const check: QualityCheck = {
            id: qualityCheckIdAt(this.#qualityCheckOrdinal++),
            subjectType: request.subjectType,
            subjectId: request.subjectId,
            status: 'pending',
        };
        this.#qualityChecks.unshift(check);
        return { id: check.id, status: check.status };
    }

    #setQualityCheckStatus(
        qualityCheckId: QualityCheckId,
        status: QualityCheck['status'],
    ): QualityCheckResult {
        const check = this.#qualityChecks.find((candidate) => candidate.id === qualityCheckId);
        if (check === undefined) throwFailure(apiFailure('resource.not_found'));

        this.#qualityChecks = this.#qualityChecks.map((candidate) =>
            candidate.id === qualityCheckId ? { ...candidate, status } : candidate,
        );
        return { id: check.id, status };
    }

    holdQualityCheck(qualityCheckId: QualityCheckId): QualityCheckResult {
        return this.#setQualityCheckStatus(qualityCheckId, 'hold');
    }

    releaseQualityCheck(qualityCheckId: QualityCheckId): QualityCheckResult {
        return this.#setQualityCheckStatus(qualityCheckId, 'released');
    }
}
