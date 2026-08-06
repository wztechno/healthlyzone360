import {
    BranchId,
    GoodsReceiptId,
    IngredientId,
    ProductionOrderId,
    QualityCheckId,
    RecipeVersionId,
    StockItemId,
    SupplierId,
} from '@healthy360/domain-types';

import type {
    CompleteProductionOrderRequest,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateStockItemRequest,
    GoodsReceipt,
    GoodsReceiptResult,
    KitchenOpsRepository,
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
} from '../contracts/kitchen-ops.ts';
import type {
    GoodsReceipt as WireGoodsReceipt,
    ProductionOrder as WireProductionOrder,
    QualityCheck as WireQualityCheck,
    StockItem as WireStockItem,
    StockLevel as WireStockLevel,
    StockMovement as WireStockMovement,
    Supplier as WireSupplier,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * Kitchen ops (O1–O4), backed by the real Laravel routes under `/catalogue/{inventory,
 * procurement, production, quality-control}`.
 *
 * None of these rows is lock-versioned, so unlike `kitchen-admin-writes.ts` no write here carries
 * an `If-Match`. And none of the mutation responses hands back a full record — the Laravel
 * controllers answer an id (and, for production orders and quality checks, the new status) rather
 * than the row itself — so every write here returns exactly what the wire promises rather than
 * inventing a follow-up read the contract does not ask for. A screen that needs the fresh row
 * re-reads the list, which is also how it discovers a row another kitchen tablet just created.
 */

function mapStockItem(wire: WireStockItem): StockItem {
    return {
        id: StockItemId.unsafe(wire.id),
        code: wire.code,
        nameEn: wire.name_en,
        unitCode: wire.unit_code,
        ingredientId: wire.ingredient_id === null ? null : IngredientId.unsafe(wire.ingredient_id),
    };
}

function mapStockLevel(wire: WireStockLevel): StockLevel {
    return {
        id: wire.id,
        branchId: BranchId.unsafe(wire.branch_id),
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        quantity: wire.quantity,
        itemCode: wire.item_code,
        itemNameEn: wire.item_name_en,
        ingredientId: wire.ingredient_id === null ? null : IngredientId.unsafe(wire.ingredient_id),
    };
}

function mapStockMovement(wire: WireStockMovement): StockMovement {
    return {
        id: wire.id,
        quantityDelta: wire.quantity_delta,
        reason: wire.reason as StockMovement['reason'],
    };
}

function mapSupplier(wire: WireSupplier): Supplier {
    return { id: SupplierId.unsafe(wire.id), code: wire.code, nameEn: wire.name_en };
}

function mapGoodsReceipt(wire: WireGoodsReceipt): GoodsReceipt {
    return {
        id: GoodsReceiptId.unsafe(wire.id),
        branchId: BranchId.unsafe(wire.branch_id),
        purchaseOrderId: wire.purchase_order_id,
        receivedAt: wire.received_at,
        lines: wire.lines.map((line) => ({
            stockItemId: StockItemId.unsafe(line.stock_item_id),
            quantity: line.quantity,
        })),
    };
}

function mapProductionOrder(wire: WireProductionOrder): ProductionOrder {
    return {
        id: ProductionOrderId.unsafe(wire.id),
        recipeVersionId: RecipeVersionId.unsafe(wire.recipe_version_id),
        status: wire.status,
        branchId: BranchId.unsafe(wire.branch_id),
    };
}

function mapQualityCheck(wire: WireQualityCheck): QualityCheck {
    return {
        id: QualityCheckId.unsafe(wire.id),
        subjectType: wire.subject_type,
        subjectId: wire.subject_id,
        status: wire.status,
    };
}

export function createApiKitchenOpsRepository(transport: Transport): KitchenOpsRepository {
    return {
        async listStockItems(): Promise<readonly StockItem[]> {
            const envelope = await transport.requestEnvelope<{
                readonly stock_items: readonly WireStockItem[];
            }>({ method: 'GET', path: '/catalogue/inventory/items' });
            return envelope.data.stock_items.map(mapStockItem);
        },

        async createStockItem(request: CreateStockItemRequest): Promise<StockItem> {
            const envelope = await transport.requestEnvelope<{
                readonly stock_item: WireStockItem;
            }>({
                method: 'POST',
                path: '/catalogue/inventory/items',
                body: {
                    code: request.code,
                    name_en: request.nameEn,
                    ...(request.unitCode === undefined ? {} : { unit_code: request.unitCode }),
                    ...(request.ingredientId === undefined
                        ? {}
                        : {
                              ingredient_id:
                                  request.ingredientId === null
                                      ? null
                                      : String(request.ingredientId),
                          }),
                },
            });
            return mapStockItem(envelope.data.stock_item);
        },

        async listStockLevels(): Promise<readonly StockLevel[]> {
            const envelope = await transport.requestEnvelope<{
                readonly levels: readonly WireStockLevel[];
            }>({ method: 'GET', path: '/catalogue/inventory/levels' });
            return envelope.data.levels.map(mapStockLevel);
        },

        async recordStockAdjustment(request: StockAdjustmentRequest): Promise<StockMovement> {
            const envelope = await transport.requestEnvelope<{
                readonly movement: WireStockMovement;
            }>({
                method: 'POST',
                path: '/catalogue/inventory/adjustments',
                body: {
                    branch_id: String(request.branchId),
                    stock_item_id: String(request.stockItemId),
                    quantity_delta: request.quantityDelta,
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });
            return mapStockMovement(envelope.data.movement);
        },

        async recordStockWaste(request: StockWasteRequest): Promise<StockMovement> {
            const envelope = await transport.requestEnvelope<{
                readonly movement: WireStockMovement;
            }>({
                method: 'POST',
                path: '/catalogue/inventory/waste',
                body: {
                    branch_id: String(request.branchId),
                    stock_item_id: String(request.stockItemId),
                    quantity: request.quantity,
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });
            return mapStockMovement(envelope.data.movement);
        },

        async listSuppliers(): Promise<readonly Supplier[]> {
            const envelope = await transport.requestEnvelope<{
                readonly suppliers: readonly WireSupplier[];
            }>({ method: 'GET', path: '/catalogue/procurement/suppliers' });
            return envelope.data.suppliers.map(mapSupplier);
        },

        async listGoodsReceipts(): Promise<readonly GoodsReceipt[]> {
            const envelope = await transport.requestEnvelope<{
                readonly goods_receipts: readonly WireGoodsReceipt[];
            }>({ method: 'GET', path: '/catalogue/procurement/goods-receipts' });
            return envelope.data.goods_receipts.map(mapGoodsReceipt);
        },

        async postGoodsReceipt(request: PostGoodsReceiptRequest): Promise<GoodsReceiptResult> {
            const envelope = await transport.requestEnvelope<{
                readonly goods_receipt: { readonly id: string };
            }>({
                method: 'POST',
                path: '/catalogue/procurement/goods-receipts',
                body: {
                    branch_id: String(request.branchId),
                    ...(request.purchaseOrderId === undefined
                        ? {}
                        : { purchase_order_id: request.purchaseOrderId }),
                    lines: request.lines.map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                    })),
                },
            });
            return { id: GoodsReceiptId.unsafe(envelope.data.goods_receipt.id) };
        },

        async listProductionOrders(): Promise<readonly ProductionOrder[]> {
            const envelope = await transport.requestEnvelope<{
                readonly production_orders: readonly WireProductionOrder[];
            }>({ method: 'GET', path: '/catalogue/production/orders' });
            return envelope.data.production_orders.map(mapProductionOrder);
        },

        async createProductionOrder(
            request: CreateProductionOrderRequest,
        ): Promise<ProductionOrderResult> {
            const envelope = await transport.requestEnvelope<{
                readonly production_order: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: '/catalogue/production/orders',
                body: {
                    branch_id: String(request.branchId),
                    recipe_version_id: String(request.recipeVersionId),
                    ...(request.plannedYield === undefined
                        ? {}
                        : { planned_yield: request.plannedYield }),
                },
            });
            return {
                id: ProductionOrderId.unsafe(envelope.data.production_order.id),
                status: envelope.data.production_order.status as ProductionOrderResult['status'],
            };
        },

        async completeProductionOrder(
            productionOrderId,
            request: CompleteProductionOrderRequest,
        ): Promise<ProductionOrderResult> {
            const envelope = await transport.requestEnvelope<{
                readonly production_order: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: `/catalogue/production/orders/${encodeURIComponent(String(productionOrderId))}/complete`,
                body: {
                    consumes: (request.consumes ?? []).map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                    })),
                    yields: (request.yields ?? []).map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                    })),
                },
            });
            return {
                id: ProductionOrderId.unsafe(envelope.data.production_order.id),
                status: envelope.data.production_order.status as ProductionOrderResult['status'],
            };
        },

        async listQualityChecks(): Promise<readonly QualityCheck[]> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_checks: readonly WireQualityCheck[];
            }>({ method: 'GET', path: '/catalogue/quality-control/checks' });
            return envelope.data.quality_checks.map(mapQualityCheck);
        },

        async createQualityCheck(request: CreateQualityCheckRequest): Promise<QualityCheckResult> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_check: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: '/catalogue/quality-control/checks',
                body: {
                    subject_type: request.subjectType,
                    subject_id: request.subjectId,
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });
            return {
                id: QualityCheckId.unsafe(envelope.data.quality_check.id),
                status: envelope.data.quality_check.status as QualityCheckResult['status'],
            };
        },

        async holdQualityCheck(qualityCheckId): Promise<QualityCheckResult> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_check: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: `/catalogue/quality-control/checks/${encodeURIComponent(String(qualityCheckId))}/hold`,
            });
            return {
                id: QualityCheckId.unsafe(envelope.data.quality_check.id),
                status: envelope.data.quality_check.status as QualityCheckResult['status'],
            };
        },

        async releaseQualityCheck(qualityCheckId): Promise<QualityCheckResult> {
            const envelope = await transport.requestEnvelope<{
                readonly quality_check: { readonly id: string; readonly status: string };
            }>({
                method: 'POST',
                path: `/catalogue/quality-control/checks/${encodeURIComponent(String(qualityCheckId))}/release`,
            });
            return {
                id: QualityCheckId.unsafe(envelope.data.quality_check.id),
                status: envelope.data.quality_check.status as QualityCheckResult['status'],
            };
        },
    };
}
