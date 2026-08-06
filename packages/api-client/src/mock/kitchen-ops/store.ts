import { BranchId } from '@healthy360/domain-types';
import type { ProductionOrderId, QualityCheckId, StockItemId } from '@healthy360/domain-types';

import { apiFailure, throwFailure, validationFailure } from '../../contracts/failure.ts';
import type {
    CompleteProductionOrderRequest,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateStockItemRequest,
    GoodsReceipt,
    GoodsReceiptResult,
    PostGoodsReceiptRequest,
    ProductionOrder,
    ProductionOrderResult,
    QualityCheck,
    QualityCheckResult,
    StockAdjustmentRequest,
    StockItem,
    StockLevel,
    StockMovement,
    StockWasteRequest,
    Supplier,
} from '../../contracts/kitchen-ops.ts';
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
            itemCode: 'FLR-001',
            itemNameEn: 'All-purpose flour',
            ingredientId: null,
        },
        {
            id: 'level-2',
            branchId: SEED_BRANCH_ID,
            stockItemId: stockItemIdAt(2),
            quantity: '18.000',
            itemCode: 'OIL-002',
            itemNameEn: 'Olive oil',
            ingredientId: null,
        },
        {
            id: 'level-3',
            branchId: SEED_BRANCH_ID,
            stockItemId: stockItemIdAt(4),
            quantity: '9.750',
            itemCode: 'CHK-020',
            itemNameEn: 'Chicken breast',
            ingredientId: null,
        },
    ];

    #movements: StockMovement[] = [];

    #suppliers: Supplier[] = [
        { id: supplierIdAt(1), code: 'SUP-001', nameEn: 'Gulf Fresh Produce' },
        { id: supplierIdAt(2), code: 'SUP-002', nameEn: 'Al Waha Meats' },
    ];

    #goodsReceipts: GoodsReceipt[] = [
        {
            id: goodsReceiptIdAt(1),
            branchId: SEED_BRANCH_ID,
            purchaseOrderId: null,
            receivedAt: '2026-08-01T09:00:00.000Z',
            lines: [{ stockItemId: stockItemIdAt(1), quantity: '25.000' }],
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
                itemCode: item.code,
                itemNameEn: item.nameEn,
                ingredientId: item.ingredientId,
            };
            this.#stockLevels.push(level);
        }

        const next = Number(level.quantity) + delta;
        const levelId = level.id;
        this.#stockLevels = this.#stockLevels.map((candidate) =>
            candidate.id === levelId ? { ...candidate, quantity: next.toFixed(3) } : candidate,
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

        const receipt: GoodsReceipt = {
            id: goodsReceiptIdAt(this.#goodsReceiptOrdinal++),
            branchId: request.branchId,
            purchaseOrderId: request.purchaseOrderId ?? null,
            receivedAt: new Date().toISOString(),
            lines: request.lines.map((line) => ({
                stockItemId: line.stockItemId,
                quantity: line.quantity.toFixed(3),
            })),
        };
        this.#goodsReceipts.push(receipt);
        return { id: receipt.id };
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
