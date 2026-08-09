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

import type { CursorPage } from '../contracts/pagination.ts';
import type {
    CompleteProductionOrderRequest,
    CreateProductionOrderRequest,
    CreateQualityCheckRequest,
    CreateStockItemRequest,
    GoodsReceipt,
    GoodsReceiptLine,
    GoodsReceiptResult,
    KitchenOpsRepository,
    PostGoodsReceiptRequest,
    ProductionOrder,
    ProductionOrderResult,
    PurchaseLedgerFilter,
    PurchaseLedgerLine,
    QualityCheck,
    QualityCheckResult,
    SetStockThresholdRequest,
    StockAdjustmentRequest,
    StockItem,
    StockLevel,
    StockMovement,
    StockWasteRequest,
    Supplier,
    SupplierRef,
} from '../contracts/kitchen-ops.ts';
import type {
    GoodsReceipt as WireGoodsReceipt,
    GoodsReceiptLine as WireGoodsReceiptLine,
    ProductionOrder as WireProductionOrder,
    PurchasesLedgerLine as WirePurchaseLedgerLine,
    QualityCheck as WireQualityCheck,
    StockItem as WireStockItem,
    StockLevel as WireStockLevel,
    StockMovement as WireStockMovement,
    Supplier as WireSupplier,
    SupplierRef as WireSupplierRef,
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
        reorderThreshold: wire.reorder_threshold,
        parLevel: wire.par_level,
        isLow: wire.is_low,
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
    return {
        id: SupplierId.unsafe(wire.id),
        code: wire.code,
        nameEn: wire.name_en,
        currencyCode: wire.currency_code,
        contactEmail: wire.contact_email,
        contactPhone: wire.contact_phone,
    };
}

function mapSupplierRef(wire: WireSupplierRef | null): SupplierRef | null {
    return wire === null
        ? null
        : { id: SupplierId.unsafe(wire.id), code: wire.code, nameEn: wire.name_en };
}

function mapGoodsReceiptLine(line: WireGoodsReceiptLine): GoodsReceiptLine {
    return {
        stockItemId: StockItemId.unsafe(line.stock_item_id),
        quantity: line.quantity,
        unitId: line.unit_id,
        unitPriceAmount: line.unit_price_amount,
        lineTotalAmount: line.line_total_amount,
        costCurrencyCode: line.cost_currency_code,
    };
}

function mapGoodsReceipt(wire: WireGoodsReceipt): GoodsReceipt {
    return {
        id: GoodsReceiptId.unsafe(wire.id),
        branchId: BranchId.unsafe(wire.branch_id),
        supplier: mapSupplierRef(wire.supplier),
        documentRef: wire.document_ref,
        purchaseOrderId: wire.purchase_order_id,
        receivedAt: wire.received_at,
        currencyCode: wire.currency_code,
        receiptTotalAmount: wire.receipt_total_amount,
        costsRedacted: wire.costs_redacted,
        lines: wire.lines.map(mapGoodsReceiptLine),
    };
}

function mapPurchaseLedgerLine(wire: WirePurchaseLedgerLine): PurchaseLedgerLine {
    return {
        id: wire.id,
        goodsReceiptId: GoodsReceiptId.unsafe(wire.goods_receipt_id),
        receivedAt: wire.received_at,
        supplier: mapSupplierRef(wire.supplier),
        documentRef: wire.document_ref,
        stockItemId: StockItemId.unsafe(wire.stock_item_id),
        itemCode: wire.item_code,
        itemNameEn: wire.item_name_en,
        ingredientId: wire.ingredient_id === null ? null : IngredientId.unsafe(wire.ingredient_id),
        quantity: wire.quantity,
        unitId: wire.unit_id,
        unitPriceAmount: wire.unit_price_amount,
        lineTotalAmount: wire.line_total_amount,
        costCurrencyCode: wire.cost_currency_code,
        costsRedacted: wire.costs_redacted,
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

        async setStockThreshold(request: SetStockThresholdRequest): Promise<StockLevel> {
            const envelope = await transport.requestEnvelope<{
                readonly level: WireStockLevel;
            }>({
                method: 'PATCH',
                path: '/catalogue/inventory/threshold',
                body: {
                    branch_id: String(request.branchId),
                    stock_item_id: String(request.stockItemId),
                    reorder_threshold: request.reorderThreshold,
                    ...(request.parLevel === undefined ? {} : { par_level: request.parLevel }),
                },
            });
            return mapStockLevel(envelope.data.level);
        },

        async countLowStockLevels(): Promise<number> {
            const envelope = await transport.requestEnvelope<{
                readonly count: number;
            }>({ method: 'GET', path: '/catalogue/inventory/low-stock-count' });
            return envelope.data.count;
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
                    ...(request.supplierId === undefined
                        ? {}
                        : { supplier_id: request.supplierId === null ? null : String(request.supplierId) }),
                    ...(request.documentRef === undefined ? {} : { document_ref: request.documentRef }),
                    ...(request.purchaseOrderId === undefined
                        ? {}
                        : { purchase_order_id: request.purchaseOrderId }),
                    lines: request.lines.map((line) => ({
                        stock_item_id: String(line.stockItemId),
                        quantity: line.quantity,
                        ...(line.unitId === undefined || line.unitId === null
                            ? {}
                            : { unit_id: String(line.unitId) }),
                        ...(line.unitPriceAmount === undefined || line.unitPriceAmount === null
                            ? {}
                            : { unit_price_amount: line.unitPriceAmount }),
                        ...(line.costCurrencyCode === undefined || line.costCurrencyCode === null
                            ? {}
                            : { cost_currency_code: line.costCurrencyCode }),
                    })),
                },
            });
            return { id: GoodsReceiptId.unsafe(envelope.data.goods_receipt.id) };
        },

        async listPurchasesLedger(
            filter: PurchaseLedgerFilter = {},
        ): Promise<CursorPage<PurchaseLedgerLine>> {
            const params = new URLSearchParams();
            if (filter.from !== undefined) params.set('from', filter.from);
            if (filter.to !== undefined) params.set('to', filter.to);
            if (filter.supplierId !== undefined) params.set('supplier_id', String(filter.supplierId));
            if (filter.ingredientId !== undefined) {
                params.set('ingredient_id', String(filter.ingredientId));
            }
            if (filter.cursor !== undefined) params.set('cursor', filter.cursor);
            if (filter.limit !== undefined) params.set('limit', String(filter.limit));

            const query = params.toString();
            const envelope = await transport.requestEnvelope<{
                readonly purchases: readonly WirePurchaseLedgerLine[];
            }>({
                method: 'GET',
                path: `/catalogue/procurement/purchases-ledger${query === '' ? '' : `?${query}`}`,
            });

            // Keyset meta only — `next_cursor`/`has_more`; a keyset never counts
            // its total, so `totalCount` is null, which the contract reserves.
            const meta = (envelope.meta ?? {}) as {
                readonly next_cursor?: string | null;
                readonly has_more?: boolean;
            };

            return {
                items: envelope.data.purchases.map(mapPurchaseLedgerLine),
                nextCursor: meta.next_cursor ?? null,
                hasMore: meta.has_more ?? false,
                totalCount: null,
            };
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
