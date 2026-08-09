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

import type { CursorPage, CursorPageRequest } from './pagination.ts';

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
    /** The reorder point as a decimal string, or `null` when no threshold is set (never low). */
    readonly reorderThreshold: string | null;
    /** The level to restock back up to, as a decimal string, or `null` when not set. */
    readonly parLevel: string | null;
    /**
     * Computed on read (INV1.3), never a stored flag: `true` when a threshold is set and the
     * quantity has reached or fallen to or below it. The same live pattern as {@link isOutOfStock}.
     */
    readonly isLow: boolean;
    readonly itemCode: string;
    readonly itemNameEn: string;
    readonly ingredientId: IngredientId | null;
}

/**
 * Sets — or clears — a level's reorder threshold (and optional par level) for one (branch, stock
 * item) pair. A `null` `reorderThreshold` clears it, which makes the item never low; `parLevel` is
 * optional and independently nullable. The server creates the level row if the item has never moved
 * at this branch, so a threshold can be set before the first receipt.
 */
export interface SetStockThresholdRequest {
    readonly branchId: BranchId;
    readonly stockItemId: StockItemId;
    /** The reorder point; `null` clears the threshold. */
    readonly reorderThreshold: number | null;
    /** Optional target level to restock back up to; `null` clears it. */
    readonly parLevel?: number | null | undefined;
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
    /** ISO 4217, the currency this supplier usually invoices in, or `null` (INV1.1). */
    readonly currencyCode: string | null;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
}

/** A supplier named on a receipt or ledger line (INV1.1). */
export interface SupplierRef {
    readonly id: SupplierId;
    readonly code: string;
    readonly nameEn: string;
}

export interface GoodsReceiptLine {
    readonly stockItemId: StockItemId;
    readonly quantity: string;
    /** The unit the price is quoted per (INV1.1); `null` on an unpriced line. */
    readonly unitId: string | null;
    /**
     * Major-unit decimal string, or `null` — either the line was unpriced, or the reader lacks
     * `inventory.view_costs_organisation` and {@link GoodsReceipt.costsRedacted} is `true`.
     */
    readonly unitPriceAmount: string | null;
    readonly lineTotalAmount: string | null;
    readonly costCurrencyCode: string | null;
}

export interface GoodsReceipt {
    readonly id: GoodsReceiptId;
    readonly branchId: BranchId;
    /** Who the stock was bought from (INV1.1), or `null`. */
    readonly supplier: SupplierRef | null;
    /** The supplier delivery note or invoice number, as written (INV1.1). */
    readonly documentRef: string | null;
    /** Always `null` in v1 — there is no purchase-order surface yet to have created one. */
    readonly purchaseOrderId: string | null;
    readonly receivedAt: IsoDateTime | null;
    /** The one currency the priced lines share, or `null` (mixed, unpriced, or redacted). */
    readonly currencyCode: string | null;
    /** The sum of the priced lines, or `null` when mixed-currency, unpriced or redacted. */
    readonly receiptTotalAmount: string | null;
    /** `true` when the reader lacks the cost permission and every money field was nulled (INV1.1). */
    readonly costsRedacted: boolean;
    readonly lines: readonly GoodsReceiptLine[];
}

export interface GoodsReceiptLineInput {
    readonly stockItemId: StockItemId;
    readonly quantity: number;
    /** Required whenever a price is given: the unit the price is quoted per (INV1.1). */
    readonly unitId?: string | null | undefined;
    /** Major-unit price per {@link unitId}. A priced line needs a `unitId` and a `costCurrencyCode`. */
    readonly unitPriceAmount?: number | null | undefined;
    readonly costCurrencyCode?: string | null | undefined;
}

export interface PostGoodsReceiptRequest {
    readonly branchId: BranchId;
    /** Who the stock was bought from (INV1.1). */
    readonly supplierId?: SupplierId | null | undefined;
    /** The supplier delivery note or invoice number (INV1.1). */
    readonly documentRef?: string | null | undefined;
    readonly purchaseOrderId?: string | null | undefined;
    readonly lines: readonly GoodsReceiptLineInput[];
}

/** The store's own reply to a post — an id only; the caller re-reads the list for the full row. */
export interface GoodsReceiptResult {
    readonly id: GoodsReceiptId;
}

/**
 * One purchases-ledger row (INV1.1) — a goods-receipt line flattened with the date, supplier and
 * item it belongs to. The browsable record behind the monthly spend figure; behind
 * `inventory.view_costs_organisation`, so the money is always present here (unlike the receipts
 * list, which redacts it for readers without that code).
 */
export interface PurchaseLedgerLine {
    readonly id: string;
    readonly goodsReceiptId: GoodsReceiptId;
    readonly receivedAt: IsoDateTime | null;
    readonly supplier: SupplierRef | null;
    readonly documentRef: string | null;
    readonly stockItemId: StockItemId;
    readonly itemCode: string | null;
    readonly itemNameEn: string | null;
    readonly ingredientId: IngredientId | null;
    readonly quantity: string;
    readonly unitId: string | null;
    readonly unitPriceAmount: string | null;
    readonly lineTotalAmount: string | null;
    readonly costCurrencyCode: string | null;
    readonly costsRedacted: boolean;
}

/** Date range / supplier / ingredient filters over the purchases ledger, plus the cursor. */
export interface PurchaseLedgerFilter extends CursorPageRequest {
    /** Inclusive lower bound on the receipt date, as `YYYY-MM-DD`. */
    readonly from?: string | undefined;
    /** Inclusive upper bound on the receipt date, as `YYYY-MM-DD`. */
    readonly to?: string | undefined;
    readonly supplierId?: SupplierId | undefined;
    readonly ingredientId?: IngredientId | undefined;
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
    /** Sets or clears a level's reorder threshold; returns the updated level with its computed `isLow`. */
    setStockThreshold(request: SetStockThresholdRequest): Promise<StockLevel>;
    /**
     * How many levels are low right now, scoped to the active branch context (`X-Branch-Id`) or the
     * whole organisation when none is set — the count the hub badge reads without opening the list.
     */
    countLowStockLevels(): Promise<number>;

    listSuppliers(): Promise<readonly Supplier[]>;
    /** The most recent fifty receipts, newest first. Costs redacted without the cost permission. */
    listGoodsReceipts(): Promise<readonly GoodsReceipt[]>;
    postGoodsReceipt(request: PostGoodsReceiptRequest): Promise<GoodsReceiptResult>;
    /** The purchases ledger — every receipt line, cursor-paginated. Needs `inventory.view_costs_organisation`. */
    listPurchasesLedger(filter?: PurchaseLedgerFilter): Promise<CursorPage<PurchaseLedgerLine>>;

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
