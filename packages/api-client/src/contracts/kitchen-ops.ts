import type {
    BranchId,
    GoodsReceiptId,
    IngredientId,
    IsoDateTime,
    ProductionOrderId,
    QualityCheckId,
    RecipeVersionId,
    StockItemId,
    SupplierId,
} from '@healthy360/domain-types';

/**
 * The kitchen ops contract (O1–O4): inventory, receipts-only procurement, production and quality
 * control.
 *
 * ## Why this is a sibling of `KitchenAdminRepository` rather than a branch of it
 *
 * `KitchenAdminRepository` is the confidential *catalogue* — recipes, products, prices, margins —
 * and every one of its records is lock-versioned and bilingual (plan §4.13, §4.18). Nothing here is
 * either. A stock item, a supplier, a goods receipt, a production order and a quality check carry
 * one language (`name_en` only — there is no publication surface for a warehouse SKU) and no
 * `lockVersion`: the backend does not version these rows, and a contract that invented one would
 * promise a conflict response the server never sends.
 *
 * ## Four scopes, deliberately locked to v1
 *
 * 1. **Inventory (O1).** Stock items are free codes with an optional `ingredientId` — a kitchen may
 *    stock packaging or cleaning supplies that will never be a recipe ingredient. Levels are
 *    per-branch and read through the active branch context (`X-Branch-Id`, set by
 *    `ContextRepository`); nothing here takes a branch filter because the header already narrows it.
 * 2. **Procurement (O2) is receipts-only.** There is no purchase-order surface: `listSuppliers` and
 *    the goods-receipt pair are the whole scope, and `GoodsReceipt.purchaseOrderId` is always `null`
 *    until one exists to point at.
 * 3. **Production (O5) has no task UI.** `ProductionOrder` carries a status and the recipe version it
 *    plans against; completing one states what it consumed and yielded, not a checklist.
 * 4. **Quality control (O4) is hold/release only.** `holdQualityCheck` / `releaseQualityCheck` are the
 *    entire lifecycle beyond opening a check; there is no separate "pass" action and no hold record
 *    distinct from the check's own `status`.
 *
 * Every list here answers the backend's own cap: stock items and suppliers are the whole table (a
 * kitchen's warehouse and supplier book are small); goods receipts, production orders and quality
 * checks are the most recent fifty. A metric built from one of these lists is therefore an honest
 * live count of what was fetched, never a fabricated KPI.
 */

/* ------------------------------------------------------------------------------------------------
 * Inventory (O1)
 * ---------------------------------------------------------------------------------------------- */

export interface StockItem {
    readonly id: StockItemId;
    readonly code: string;
    readonly nameEn: string;
    readonly unitCode: string;
    readonly ingredientId: IngredientId | null;
}

export interface CreateStockItemRequest {
    readonly code: string;
    readonly nameEn: string;
    /** Defaults to `kg` server-side when omitted. */
    readonly unitCode?: string | undefined;
    readonly ingredientId?: IngredientId | null | undefined;
}

/** One stock item's on-hand quantity at one branch, denormalised so a levels row needs no join. */
export interface StockLevel {
    readonly id: string;
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** A decimal string, never a float — the wire's own precision guarantee. */
    readonly quantity: string;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly ingredientId: IngredientId | null;
}

export const STOCK_MOVEMENT_REASONS = ['adjust', 'waste', 'receipt', 'consume', 'yield'] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

export interface StockMovement {
    readonly id: string;
    /** Signed — negative for waste and consumption, positive for receipts, yields and increases. */
    readonly quantityDelta: string;
    readonly reason: StockMovementReason;
}

export interface StockAdjustmentRequest {
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** Signed: a correction that raises the level is positive, one that lowers it is negative. */
    readonly quantityDelta: number;
    readonly notes?: string | null | undefined;
}

export interface StockWasteRequest {
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** Always positive; the server signs it negative on the ledger. */
    readonly quantity: number;
    readonly notes?: string | null | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Procurement (O2) — receipts-only
 * ---------------------------------------------------------------------------------------------- */

export interface Supplier {
    readonly id: SupplierId;
    readonly code: string;
    readonly nameEn: string;
}

export interface GoodsReceiptLine {
    readonly stockItemId: StockItemId;
    readonly quantity: string;
}

export interface GoodsReceipt {
    readonly id: GoodsReceiptId;
    readonly branchId: BranchId;
    /** Always `null` in v1 — there is no purchase-order surface yet to have created one. */
    readonly purchaseOrderId: string | null;
    readonly receivedAt: IsoDateTime | null;
    readonly lines: readonly GoodsReceiptLine[];
}

export interface GoodsReceiptLineInput {
    readonly stockItemId: StockItemId;
    readonly quantity: number;
}

export interface PostGoodsReceiptRequest {
    readonly branchId: BranchId;
    readonly purchaseOrderId?: string | null | undefined;
    readonly lines: readonly GoodsReceiptLineInput[];
}

/** The store's own reply to a post — an id only; the caller re-reads the list for the full row. */
export interface GoodsReceiptResult {
    readonly id: GoodsReceiptId;
}

/* ------------------------------------------------------------------------------------------------
 * Production (O5) — no task UI
 * ---------------------------------------------------------------------------------------------- */

export const PRODUCTION_ORDER_STATUSES = [
    'planned',
    'in_progress',
    'completed',
    'cancelled',
] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export interface ProductionOrder {
    readonly id: ProductionOrderId;
    readonly recipeVersionId: RecipeVersionId;
    readonly status: ProductionOrderStatus;
    readonly branchId: BranchId;
}

export interface CreateProductionOrderRequest {
    readonly branchId: BranchId;
    readonly recipeVersionId: RecipeVersionId;
    readonly plannedYield?: number | null | undefined;
}

export interface ProductionMovementInput {
    readonly stockItemId: StockItemId;
    readonly quantity: number;
}

export interface CompleteProductionOrderRequest {
    readonly consumes?: readonly ProductionMovementInput[] | undefined;
    readonly yields?: readonly ProductionMovementInput[] | undefined;
}

export interface ProductionOrderResult {
    readonly id: ProductionOrderId;
    readonly status: ProductionOrderStatus;
}

/* ------------------------------------------------------------------------------------------------
 * Quality control (O4) — hold/release only
 * ---------------------------------------------------------------------------------------------- */

export const QUALITY_CHECK_SUBJECT_TYPES = ['goods_receipt', 'production_order'] as const;
export type QualityCheckSubjectType = (typeof QUALITY_CHECK_SUBJECT_TYPES)[number];

export const QUALITY_CHECK_STATUSES = ['pending', 'passed', 'hold', 'released'] as const;
export type QualityCheckStatus = (typeof QUALITY_CHECK_STATUSES)[number];

export interface QualityCheck {
    readonly id: QualityCheckId;
    readonly subjectType: QualityCheckSubjectType;
    /** A {@link GoodsReceiptId} or a {@link ProductionOrderId}, depending on `subjectType`. */
    readonly subjectId: string;
    readonly status: QualityCheckStatus;
}

export interface CreateQualityCheckRequest {
    readonly subjectType: QualityCheckSubjectType;
    readonly subjectId: string;
    readonly notes?: string | null | undefined;
}

export interface QualityCheckResult {
    readonly id: QualityCheckId;
    readonly status: QualityCheckStatus;
}

/* ------------------------------------------------------------------------------------------------
 * The repository
 * ---------------------------------------------------------------------------------------------- */

export interface KitchenOpsRepository {
    /** Every stock item the organisation has declared. Not paginated — see the file header. */
    listStockItems(): Promise<readonly StockItem[]>;
    createStockItem(request: CreateStockItemRequest): Promise<StockItem>;

    /** Every level the active branch context can see (`X-Branch-Id`, not a parameter here). */
    listStockLevels(): Promise<readonly StockLevel[]>;
    recordStockAdjustment(request: StockAdjustmentRequest): Promise<StockMovement>;
    recordStockWaste(request: StockWasteRequest): Promise<StockMovement>;

    listSuppliers(): Promise<readonly Supplier[]>;
    /** The most recent fifty receipts, newest first. */
    listGoodsReceipts(): Promise<readonly GoodsReceipt[]>;
    postGoodsReceipt(request: PostGoodsReceiptRequest): Promise<GoodsReceiptResult>;

    /** The most recent fifty production orders, newest first. */
    listProductionOrders(): Promise<readonly ProductionOrder[]>;
    createProductionOrder(request: CreateProductionOrderRequest): Promise<ProductionOrderResult>;
    completeProductionOrder(
        productionOrderId: ProductionOrderId,
        request: CompleteProductionOrderRequest,
    ): Promise<ProductionOrderResult>;

    /** The most recent fifty checks, newest first, over both allow-listed subjects. */
    listQualityChecks(): Promise<readonly QualityCheck[]>;
    createQualityCheck(request: CreateQualityCheckRequest): Promise<QualityCheckResult>;
    holdQualityCheck(qualityCheckId: QualityCheckId): Promise<QualityCheckResult>;
    releaseQualityCheck(qualityCheckId: QualityCheckId): Promise<QualityCheckResult>;
}
