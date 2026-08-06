import type {
    ProductionOrderStatus,
    QualityCheckStatus,
    QualityCheckSubjectType,
    StockItem,
} from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';

/**
 * Display helpers for the kitchen ops workspace (O1–O4).
 *
 * A sibling of `./format.ts` rather than an addition to it, for the same reason the contract and
 * the query-key group are siblings: nothing here shares a vocabulary with the K1 catalogue — a
 * stock item's unit code is not a `MeasureUnit` picker away from a recipe line (the ledger takes
 * free-text unit codes, `contracts/kitchen-ops.ts`), and a production order's status is its own
 * closed set, not `PublishableStatus`.
 */

/* ── stock items ─────────────────────────────────────────────────────────────────────────────── */

/** `CODE — Name`, the one line a picker or a table cell needs to identify a stock item. */
export function stockItemLabel(item: StockItem): string {
    return `${item.code} — ${item.nameEn}`;
}

/** `true` when a level's quantity is at or below zero — a live count, not a stored flag. */
export function isOutOfStock(quantity: string): boolean {
    return Number(quantity) <= 0;
}

/* ── production orders ──────────────────────────────────────────────────────────────────────── */

const PRODUCTION_STATUS_KEYS: Readonly<Record<ProductionOrderStatus, string>> = {
    planned: 'kitchen:ops.production.status.planned',
    in_progress: 'kitchen:ops.production.status.inProgress',
    completed: 'kitchen:ops.production.status.completed',
    cancelled: 'kitchen:ops.production.status.cancelled',
};

export function productionStatusKey(status: ProductionOrderStatus): string {
    return PRODUCTION_STATUS_KEYS[status];
}

const PRODUCTION_STATUS_TONES: Readonly<Record<ProductionOrderStatus, BadgeTone>> = {
    planned: 'neutral',
    in_progress: 'info',
    completed: 'success',
    cancelled: 'neutral',
};

export function productionStatusTone(status: ProductionOrderStatus): BadgeTone {
    return PRODUCTION_STATUS_TONES[status];
}

/** `true` for a status a "complete" action may still be sent for. */
export function isProductionOrderOpen(status: ProductionOrderStatus): boolean {
    return status === 'planned' || status === 'in_progress';
}

/* ── quality checks ──────────────────────────────────────────────────────────────────────────── */

const QUALITY_CHECK_STATUS_KEYS: Readonly<Record<QualityCheckStatus, string>> = {
    pending: 'kitchen:ops.qc.status.pending',
    passed: 'kitchen:ops.qc.status.passed',
    hold: 'kitchen:ops.qc.status.hold',
    released: 'kitchen:ops.qc.status.released',
};

export function qualityCheckStatusKey(status: QualityCheckStatus): string {
    return QUALITY_CHECK_STATUS_KEYS[status];
}

const QUALITY_CHECK_STATUS_TONES: Readonly<Record<QualityCheckStatus, BadgeTone>> = {
    pending: 'neutral',
    passed: 'success',
    hold: 'warning',
    released: 'success',
};

export function qualityCheckStatusTone(status: QualityCheckStatus): BadgeTone {
    return QUALITY_CHECK_STATUS_TONES[status];
}

const QUALITY_CHECK_SUBJECT_KEYS: Readonly<Record<QualityCheckSubjectType, string>> = {
    goods_receipt: 'kitchen:ops.qc.subject.goodsReceipt',
    production_order: 'kitchen:ops.qc.subject.productionOrder',
};

export function qualityCheckSubjectKey(subjectType: QualityCheckSubjectType): string {
    return QUALITY_CHECK_SUBJECT_KEYS[subjectType];
}

/* ── identifiers used by tests and Playwright ────────────────────────────────────────────────── */

export function stockItemRowTestId(stockItemId: string): string {
    return `kitchen-stock-item-${stockItemId}`;
}

export function stockLevelRowTestId(levelId: string): string {
    return `kitchen-stock-level-${levelId}`;
}

export function supplierRowTestId(supplierId: string): string {
    return `kitchen-supplier-${supplierId}`;
}

export function goodsReceiptRowTestId(goodsReceiptId: string): string {
    return `kitchen-goods-receipt-${goodsReceiptId}`;
}

export function productionOrderRowTestId(productionOrderId: string): string {
    return `kitchen-production-order-${productionOrderId}`;
}

export function qualityCheckRowTestId(qualityCheckId: string): string {
    return `kitchen-quality-check-${qualityCheckId}`;
}
