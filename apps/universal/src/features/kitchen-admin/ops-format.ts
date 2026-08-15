import type {
    KitchenOrderCancellationReason,
    KitchenOrderStatus,
    KitchenQuotationLine,
    KitchenQuotationStatus,
    ProductionOrderStatus,
    QualityCheckStatus,
    QualityCheckSubjectType,
    StockItem,
} from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';

import { ticketAgeTone } from '../kds/kds-board.ts';

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

/* ── kitchen orders (O6) ─────────────────────────────────────────────────────────────────────── */

const KITCHEN_ORDER_STATUS_KEYS: Readonly<Record<KitchenOrderStatus, string>> = {
    placed: 'kitchen:ops.orders.status.placed',
    confirmed: 'kitchen:ops.orders.status.confirmed',
    fulfilled: 'kitchen:ops.orders.status.fulfilled',
    cancelled: 'kitchen:ops.orders.status.cancelled',
};

export function kitchenOrderStatusKey(status: KitchenOrderStatus): string {
    return KITCHEN_ORDER_STATUS_KEYS[status];
}

/**
 * The tone an order's status badge carries.
 *
 * `placed` is a warning rather than a neutral tone, and that is the one interesting choice here: an
 * unconfirmed order is *work nobody has accepted yet*, which is the only state on this list that is
 * somebody's job right now. Neutral would read as a settled state, exactly as it would on a
 * quarantined catalogue row (`./format.ts`). Colour never carries it alone — `Badge` pairs every
 * tone with its own icon, and the label is beside it.
 */
const KITCHEN_ORDER_STATUS_TONES: Readonly<Record<KitchenOrderStatus, BadgeTone>> = {
    placed: 'warning',
    confirmed: 'info',
    fulfilled: 'success',
    cancelled: 'neutral',
};

export function kitchenOrderStatusTone(status: KitchenOrderStatus): BadgeTone {
    return KITCHEN_ORDER_STATUS_TONES[status];
}

const KITCHEN_ORDER_CANCELLATION_REASON_KEYS: Readonly<
    Record<KitchenOrderCancellationReason, string>
> = {
    customer_requested: 'kitchen:ops.orders.reason.customerRequested',
    kitchen_unable_to_fulfil: 'kitchen:ops.orders.reason.kitchenUnableToFulfil',
    delivery_unavailable: 'kitchen:ops.orders.reason.deliveryUnavailable',
    address_unreachable: 'kitchen:ops.orders.reason.addressUnreachable',
};

export function kitchenOrderCancellationReasonKey(reason: KitchenOrderCancellationReason): string {
    return KITCHEN_ORDER_CANCELLATION_REASON_KEYS[reason];
}

/**
 * The three lifecycle actions, restated as the questions a button asks.
 *
 * They mirror the contract's machine (`contracts/kitchen-orders.ts`) rather than restating it: a
 * button that offered "Fulfil" on a `placed` order would earn a `resource.conflict` the person did
 * nothing to deserve, and the panel decides what to *show* from exactly the same table the store
 * decides what to *accept* from.
 */
export function canConfirmKitchenOrder(status: KitchenOrderStatus): boolean {
    return status === 'placed';
}

export function canFulfilKitchenOrder(status: KitchenOrderStatus): boolean {
    return status === 'confirmed';
}

export function canCancelKitchenOrder(status: KitchenOrderStatus): boolean {
    return status === 'placed' || status === 'confirmed';
}

/* ── the order desk queue ────────────────────────────────────────────────────────────────────── */

/**
 * Whole minutes an order is *past* the instant it was due, clamped at zero.
 *
 * Clamped rather than signed, because the two sides of the deadline are different questions and only
 * one of them is this function's. "Due in forty minutes" is a time, and the row shows it as one; "we
 * are forty minutes late" is a state of alarm, and it is the only thing the ageing scale below is
 * asked to grade. A signed value would let a badge get louder the *earlier* an order is, which is
 * the opposite of the truth.
 *
 * A `dueAt` that cannot be parsed reads as zero — not late. The wire declares the field non-null and
 * the server computes it for every row, so this is unreachable behind a conformant endpoint; when it
 * is reached, a neutral row is the failure that does not manufacture an emergency.
 */
export function minutesPastDue(dueAt: string, now: Date): number {
    const due = Date.parse(dueAt);
    if (Number.isNaN(due)) return 0;
    return Math.max(0, Math.floor((now.getTime() - due) / 60_000));
}

/**
 * The tone the desk queue's due badge carries.
 *
 * Deliberately `ticketAgeTone` — the kitchen display's own scale, amber at fifteen minutes and red
 * at thirty — rather than a second table with the same numbers in it. The two surfaces are looking
 * at the same orders from two seats, and an order that is red on the wall has to be red at the desk;
 * two tables would agree today and drift the first time one of them is tuned.
 *
 * What differs is what the minutes are measured *from*. The board ages a ticket from when it was
 * placed, because a cook's question is "how long has this been waiting on me?". The desk ages it
 * from when it is **due**, because a desk's question is "how late are we to the customer?" — and an
 * order placed a fortnight ago for tomorrow lunchtime is not late at all.
 */
export function orderDeskDueTone(dueAt: string, now: Date): BadgeTone {
    return ticketAgeTone(minutesPastDue(dueAt, now));
}

/* ── B2B quotations (B4) ─────────────────────────────────────────────────────────────────────── */

const KITCHEN_QUOTATION_STATUS_KEYS: Readonly<Record<KitchenQuotationStatus, string>> = {
    submitted: 'kitchen:ops.quotations.status.submitted',
    quoted: 'kitchen:ops.quotations.status.quoted',
    accepted: 'kitchen:ops.quotations.status.accepted',
    declined: 'kitchen:ops.quotations.status.declined',
    expired: 'kitchen:ops.quotations.status.expired',
};

export function kitchenQuotationStatusKey(status: KitchenQuotationStatus): string {
    return KITCHEN_QUOTATION_STATUS_KEYS[status];
}

/**
 * The tone a quotation's status badge carries.
 *
 * `submitted` is a warning on exactly the grounds `placed` is one on an order: it is the only state
 * on this list that is somebody's job *right now* — a buyer is waiting on a price — and neutral
 * would read as settled. `declined` and `expired` are neutral rather than danger: a buyer walking
 * away is an outcome, not a fault, and colouring it as an error would ask a kitchen manager to
 * treat a closed negotiation as a problem to fix.
 */
const KITCHEN_QUOTATION_STATUS_TONES: Readonly<Record<KitchenQuotationStatus, BadgeTone>> = {
    submitted: 'warning',
    quoted: 'info',
    accepted: 'success',
    declined: 'neutral',
    expired: 'neutral',
};

export function kitchenQuotationStatusTone(status: KitchenQuotationStatus): BadgeTone {
    return KITCHEN_QUOTATION_STATUS_TONES[status];
}

/**
 * The one transition this side of the relationship owns, restated as the question the button asks.
 *
 * `submitted → quoted` and nothing else — the contract's machine, read from the same table the
 * server enforces. A "Send prices" control offered on a `quoted` or `accepted` row would earn a
 * `b2b.quotation_state_invalid` the person did nothing to deserve.
 */
export function canQuoteKitchenQuotation(status: KitchenQuotationStatus): boolean {
    return status === 'submitted';
}

/** `true` once every line carries a price — what the wire says a `quoted` quotation looks like. */
export function isKitchenQuotationPriced(lines: readonly KitchenQuotationLine[]): boolean {
    return lines.length > 0 && lines.every((line) => line.lineTotalMinor !== null);
}

/**
 * The quotation's total, or `null` when any line is still unpriced.
 *
 * Summed here rather than read from the wire because the wire carries no total: it prices lines, and
 * the sum of a set that is only partly priced is not a smaller total, it is not a total at all. The
 * currency is the quotation's own, so there is no cross-currency case to guard against.
 */
export function kitchenQuotationTotalMinor(lines: readonly KitchenQuotationLine[]): number | null {
    if (!isKitchenQuotationPriced(lines)) return null;
    return lines.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0);
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

export function kitchenOrderRowTestId(orderId: string): string {
    return `kitchen-order-${orderId}`;
}

export function kitchenQuotationRowTestId(quotationId: string): string {
    return `kitchen-quotation-${quotationId}`;
}

/**
 * A desk queue row. Its own prefix rather than `kitchenOrderRowTestId`'s even though the subject is
 * the same order: both surfaces can be on screen in one Playwright run, and two nodes under one id
 * is a query that silently finds the wrong one.
 */
export function orderDeskRowTestId(orderId: string): string {
    return `kitchen-order-desk-row-${orderId}`;
}
