import type {
    DriverJobStatus,
    DriverJobTrackingStatus,
    KitchenOrderCancellationReason,
    KitchenOrderFulfilmentType,
    KitchenOrderPaymentMethod,
    KitchenOrderStatus,
    KitchenQuotationLine,
    KitchenQuotationStatus,
    OrderDeskDriver,
    OrderDeskQueueRow,
    ProductionOrderStatus,
    PurchaseOrderStatus,
    ReceiptCostStatus,
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

/**
 * How an order is being paid, as words.
 *
 * Lives here rather than in either screen because both the sale wizard and the queue name the same
 * three methods, and a second copy of this table beside the queue's payment cell would be the one
 * that stopped matching. The keys are the wizard's own (`desk.sale.method.*`) rather than duplicated
 * under a queue-shaped name: the words are identical, and translating "Cash at the counter" twice
 * would eventually produce two translations of it.
 */
const KITCHEN_ORDER_PAYMENT_METHOD_KEYS: Readonly<Record<KitchenOrderPaymentMethod, string>> = {
    cash_on_delivery: 'kitchen:desk.sale.method.cashOnDelivery',
    cash_at_counter: 'kitchen:desk.sale.method.cashAtCounter',
    wish: 'kitchen:desk.sale.method.wish',
};

export function kitchenOrderPaymentMethodKey(method: KitchenOrderPaymentMethod): string {
    return KITCHEN_ORDER_PAYMENT_METHOD_KEYS[method];
}

const KITCHEN_ORDER_FULFILMENT_TYPE_KEYS: Readonly<Record<KitchenOrderFulfilmentType, string>> = {
    delivery: 'kitchen:desk.sale.type.delivery',
    pickup: 'kitchen:desk.sale.type.pickup',
    counter: 'kitchen:desk.sale.type.counter',
};

export function kitchenOrderFulfilmentTypeKey(type: KitchenOrderFulfilmentType): string {
    return KITCHEN_ORDER_FULFILMENT_TYPE_KEYS[type];
}

/* ── the delivery run behind an order ────────────────────────────────────────────────────────── */

/**
 * Which of four things the delivery column has to say about a row.
 *
 * The four are not four renderings of one fact; they are four different states of the world, and
 * collapsing any pair would lose something a desk acts on:
 *
 * - `not_delivered` — a pickup or a counter sale. Nothing is being driven anywhere, ever. The cell
 *   is an em dash, on the same terms as every other "nothing to say here" cell in this workspace.
 * - `awaiting_confirmation` — a delivery still `placed`. The run is created *on confirm*, so there
 *   is nothing missing here: confirming the order is what makes one.
 * - `unassigned` — a run exists and nobody has it. This is the only state that is somebody's job
 *   right now, which is why it is the only one that carries a warning tone.
 * - `assigned` — somebody has it, and the row says when they were given it.
 *
 * A confirmed delivery with no job at all also reads as `unassigned`… and it must not, so it does
 * not: it reads as {@link OrderDeskDeliveryState.no_run}, the fifth state, which is an order
 * confirmed before the delivery chain existed. Nothing will ever project a job for it and no amount
 * of waiting will change that, so a cell promising a driver would be promising a driver forever.
 */
export type OrderDeskDeliveryState =
    'not_delivered' | 'awaiting_confirmation' | 'no_run' | 'unassigned' | 'assigned';

/**
 * Read the state from the row, and **only** from the row.
 *
 * `deliveryJob === null` is true of three different orders and the wire says so explicitly; the two
 * fields that tell them apart — `fulfilmentType` and `status` — are on the same row, which is why
 * this is a pure function of one argument rather than something the screen assembles from a job read
 * and a guess.
 */
export function orderDeskDeliveryState(row: OrderDeskQueueRow): OrderDeskDeliveryState {
    if (row.fulfilmentType !== 'delivery') return 'not_delivered';
    if (row.deliveryJob === null) {
        return row.status === 'placed' ? 'awaiting_confirmation' : 'no_run';
    }
    return row.deliveryJob.driverUserId === null ? 'unassigned' : 'assigned';
}

const ORDER_DESK_DELIVERY_STATE_KEYS: Readonly<Record<OrderDeskDeliveryState, string>> = {
    not_delivered: 'kitchen:desk.delivery.notDelivered',
    awaiting_confirmation: 'kitchen:desk.delivery.awaitingConfirmation',
    no_run: 'kitchen:desk.delivery.noRun',
    unassigned: 'kitchen:desk.delivery.unassigned',
    assigned: 'kitchen:desk.delivery.assigned',
};

export function orderDeskDeliveryStateKey(state: OrderDeskDeliveryState): string {
    return ORDER_DESK_DELIVERY_STATE_KEYS[state];
}

/**
 * The tone the delivery cell carries.
 *
 * Only `unassigned` is loud, and it is loud for the reason `placed` is on an order status badge: it
 * is the one state on this list that is *somebody's job right now*. `no_run` is deliberately not a
 * danger tone — an order confirmed before the delivery chain shipped is history, not a fault
 * somebody at this desk can fix — and the label carries the whole of the meaning either way.
 */
const ORDER_DESK_DELIVERY_STATE_TONES: Readonly<Record<OrderDeskDeliveryState, BadgeTone>> = {
    not_delivered: 'neutral',
    awaiting_confirmation: 'neutral',
    no_run: 'neutral',
    unassigned: 'warning',
    assigned: 'info',
};

export function orderDeskDeliveryStateTone(state: OrderDeskDeliveryState): BadgeTone {
    return ORDER_DESK_DELIVERY_STATE_TONES[state];
}

/**
 * The two axes of a delivery job, as the *desk* says them.
 *
 * Not the driver screen's `kitchen:driver.status.*` keys, and that is about voice rather than about
 * vocabulary: "Assigned to you" is true on a run sheet and false on a dispatch board, where the
 * whole question is *whose* it is. The values are the same wire enum, read whole in both places.
 */
const DELIVERY_JOB_STATUS_KEYS: Readonly<Record<DriverJobStatus, string>> = {
    pending: 'kitchen:desk.delivery.status.pending',
    assigned: 'kitchen:desk.delivery.status.assigned',
    in_transit: 'kitchen:desk.delivery.status.inTransit',
    delivered: 'kitchen:desk.delivery.status.delivered',
    failed: 'kitchen:desk.delivery.status.failed',
    cancelled: 'kitchen:desk.delivery.status.cancelled',
};

export function deliveryJobStatusKey(status: DriverJobStatus): string {
    return DELIVERY_JOB_STATUS_KEYS[status];
}

const DELIVERY_JOB_TRACKING_KEYS: Readonly<Record<DriverJobTrackingStatus, string>> = {
    awaiting_assignment: 'kitchen:desk.delivery.tracking.awaitingAssignment',
    picked_up: 'kitchen:desk.delivery.tracking.pickedUp',
    en_route: 'kitchen:desk.delivery.tracking.enRoute',
    arrived: 'kitchen:desk.delivery.tracking.arrived',
    delivered: 'kitchen:desk.delivery.tracking.delivered',
};

export function deliveryJobTrackingKey(status: DriverJobTrackingStatus): string {
    return DELIVERY_JOB_TRACKING_KEYS[status];
}

/**
 * Whether a run can still be given to somebody.
 *
 * A closed record rather than a `!TERMINAL.includes(…)` test, so the day the wire gains a seventh
 * dispatch state this stops compiling and somebody decides what it means — which is exactly the
 * decision a permissive default would make silently and wrongly.
 *
 * The three `false` rows are the states the endpoint answers `409` on with **no**
 * `currentLockVersion`: a delivered, failed or cancelled run is over, and re-reading it will not
 * make it assignable. Hiding the control there is an experience improvement and nothing more — the
 * server remains the authority, and the drawer still handles a run that finishes between the frame
 * it rendered and the press, because that race is real on a fifteen-second poll.
 *
 * `in_transit` is deliberately `true`. A driver on the road who breaks down is a dispatcher's
 * ordinary evening, and refusing the reassignment client-side would leave the food where it is.
 */
const DELIVERY_JOB_ASSIGNABLE: Readonly<Record<DriverJobStatus, boolean>> = {
    pending: true,
    assigned: true,
    in_transit: true,
    delivered: false,
    failed: false,
    cancelled: false,
};

export function canAssignDeliveryJob(status: DriverJobStatus): boolean {
    return DELIVERY_JOB_ASSIGNABLE[status];
}

/**
 * The drivers whose name contains `query`, in the order the server answered them.
 *
 * **Client-side, and only because the list is small and whole.** The endpoint is bounded at a
 * hundred rows with no second page and no search parameter of its own, so every row a picker could
 * ever offer is already in hand; a round trip per keystroke would be a request to re-fetch a list
 * the screen is holding. A surface with a cursor would have to ask the server instead, and this
 * function would be the wrong shape for it — which is the point of it living here rather than
 * inside a component that could quietly grow one.
 *
 * Three properties worth stating:
 *
 * - **Order is never touched.** The server sorts by name with the nameless last, in SQL, over the
 *   whole membership rather than over the page it returned; re-sorting here would be a second
 *   opinion about a sequence that has already been decided properly.
 * - **A nameless member drops out of a non-empty search**, and cannot do otherwise: there is no
 *   text to match. They are still offered whenever the box is empty, which is how somebody reaches
 *   them — and it is why the empty state of this picker says to clear the search rather than
 *   claiming nobody is available.
 * - Matching is case-insensitive on the locale's own terms (`toLocaleLowerCase`), because a picker
 *   that could not find "رانيا" by typing it would be a picker for English names.
 */
export function filterDrivers(
    drivers: readonly OrderDeskDriver[],
    query: string,
): readonly OrderDeskDriver[] {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === '') return drivers;
    return drivers.filter(
        (driver) =>
            driver.displayName !== null && driver.displayName.toLocaleLowerCase().includes(needle),
    );
}

/* ── purchase orders (SUP4) ──────────────────────────────────────────────────────────────────── */

const PURCHASE_ORDER_STATUS_KEYS: Readonly<Record<PurchaseOrderStatus, string>> = {
    draft: 'kitchen:ops.supplyOrders.status.draft',
    issued: 'kitchen:ops.supplyOrders.status.issued',
    partially_received: 'kitchen:ops.supplyOrders.status.partiallyReceived',
    received: 'kitchen:ops.supplyOrders.status.received',
    cancelled: 'kitchen:ops.supplyOrders.status.cancelled',
};

export function purchaseOrderStatusKey(status: PurchaseOrderStatus): string {
    return PURCHASE_ORDER_STATUS_KEYS[status];
}

/**
 * The tone an order's status badge carries.
 *
 * `draft` is a warning on exactly the grounds `placed` is on a kitchen order: it is the only state
 * on this list that is *somebody's job right now* — an order nobody has issued buys nothing — and
 * neutral would read as settled. `cancelled` is neutral rather than danger: calling an order off is
 * an outcome, not a fault, and colouring it as an error would ask a manager to treat a closed
 * decision as a problem to fix.
 *
 * `partially_received` shares `issued`'s info tone rather than earning a louder one. A half
 * delivery is the ordinary shape of a wholesale order, not an exception.
 */
const PURCHASE_ORDER_STATUS_TONES: Readonly<Record<PurchaseOrderStatus, BadgeTone>> = {
    draft: 'warning',
    issued: 'info',
    partially_received: 'info',
    received: 'success',
    cancelled: 'neutral',
};

export function purchaseOrderStatusTone(status: PurchaseOrderStatus): BadgeTone {
    return PURCHASE_ORDER_STATUS_TONES[status];
}

/**
 * The three questions the detail screen's controls ask, as closed records over all five statuses.
 *
 * Closed rather than `status === 'draft'` tests for the reason `DELIVERY_JOB_ASSIGNABLE` is: the day
 * the wire gains a sixth state this stops compiling and somebody decides what it means, which is
 * exactly the decision a permissive default would make silently and wrongly. They mirror the
 * server's own machine rather than restating it — a control offered on a state the service refuses
 * would earn a `resource.conflict` the person did nothing to deserve.
 *
 * The two receiving rows are filled in **now**, ahead of the slice that can reach them, and the
 * values are not placeholders:
 *
 * - **editing** is false from `issued` onward, because issuing freezes the document a supplier is
 *   holding a copy of;
 * - **issuing** is false everywhere but `draft` — there is one way in and it happens once;
 * - **cancelling** is false from `partially_received` onward, and that is the interesting one.
 *   §3.5: an order with deliveries against it cannot be cancelled as though nothing happened. The
 *   receiving slice's backend refuses it, and hiding the control now means the button never appears
 *   on a row the server would refuse.
 */
const PURCHASE_ORDER_LINES_EDITABLE: Readonly<Record<PurchaseOrderStatus, boolean>> = {
    draft: true,
    issued: false,
    partially_received: false,
    received: false,
    cancelled: false,
};

export function canEditPurchaseOrderLines(status: PurchaseOrderStatus): boolean {
    return PURCHASE_ORDER_LINES_EDITABLE[status];
}

const PURCHASE_ORDER_ISSUABLE: Readonly<Record<PurchaseOrderStatus, boolean>> = {
    draft: true,
    issued: false,
    partially_received: false,
    received: false,
    cancelled: false,
};

export function canIssuePurchaseOrder(status: PurchaseOrderStatus): boolean {
    return PURCHASE_ORDER_ISSUABLE[status];
}

const PURCHASE_ORDER_CANCELLABLE: Readonly<Record<PurchaseOrderStatus, boolean>> = {
    draft: true,
    issued: true,
    partially_received: false,
    received: false,
    cancelled: false,
};

export function canCancelPurchaseOrder(status: PurchaseOrderStatus): boolean {
    return PURCHASE_ORDER_CANCELLABLE[status];
}

/**
 * Whether an order can still take a delivery (SUP5, §3.5).
 *
 * The two states a van can arrive against, and no others. A draft has been handed to nobody, and a
 * received or cancelled order is terminal — the server refuses a delivery against any of the three,
 * so offering the action would earn a `resource.conflict` the person did nothing to deserve.
 */
const PURCHASE_ORDER_RECEIVABLE: Readonly<Record<PurchaseOrderStatus, boolean>> = {
    draft: false,
    issued: true,
    partially_received: true,
    received: false,
    cancelled: false,
};

export function canReceivePurchaseOrder(status: PurchaseOrderStatus): boolean {
    return PURCHASE_ORDER_RECEIVABLE[status];
}

/* ── receipt costing (SUP5) ──────────────────────────────────────────────────────────────────── */

const RECEIPT_COST_STATUS_KEYS: Readonly<Record<ReceiptCostStatus, string>> = {
    unpriced: 'kitchen:ops.receiving.costStatus.unpriced',
    partial: 'kitchen:ops.receiving.costStatus.partial',
    complete: 'kitchen:ops.receiving.costStatus.complete',
};

export function receiptCostStatusKey(status: ReceiptCostStatus): string {
    return RECEIPT_COST_STATUS_KEYS[status];
}

/**
 * The tone a receipt's costing badge carries.
 *
 * Both unfinished states are `warning` and neither is `danger`: an invoice that has not arrived yet
 * is somebody's job, not a fault, and colouring it as an error would ask a manager to treat the
 * ordinary rhythm of wholesale paperwork as a problem to fix. They are the same tone because they
 * are the same call to action — open this receipt — and the counts beside them are what distinguish
 * "type these prices in" from "the prices are here and something else is blocking".
 */
const RECEIPT_COST_STATUS_TONES: Readonly<Record<ReceiptCostStatus, BadgeTone>> = {
    unpriced: 'warning',
    partial: 'warning',
    complete: 'success',
};

export function receiptCostStatusTone(status: ReceiptCostStatus): BadgeTone {
    return RECEIPT_COST_STATUS_TONES[status];
}

/**
 * How much of an ordered line is still to come, as a display string.
 *
 * The server already floors it at zero and expresses all three quantities in the line's own unit, so
 * this is a read rather than an arithmetic — deliberately. A screen that recomputed "ordered minus
 * received" would be a second answer to a question the receiving guard has already answered, and the
 * two would eventually disagree about a delivery quoted in a different unit.
 */
export function outstandingLabel(line: {
    readonly outstandingQuantity: string;
    readonly unitCode: string;
}): string {
    return `${line.outstandingQuantity} ${line.unitCode}`;
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

/**
 * One contact card in the supplier contact editor (SUP1).
 *
 * Keyed by the editor's own local key rather than by the contact's identifier, because a card
 * a person has just added has no identifier yet — the set-replace mints one on save. A test id
 * that only existed for saved rows would be missing from exactly the card a test wants to fill in.
 */
export function supplierContactRowTestId(localKey: string): string {
    return `kitchen-supplier-contact-${localKey}`;
}

/**
 * One supplied-item row on the supplier's page (SUP2).
 *
 * Keyed by the *stock item*, not by a link identifier: the API identifies a link by its
 * `(supplier, item)` pair and never publishes a row id, and the supplier is already fixed by the
 * page the row is on.
 */
export function suppliedItemRowTestId(stockItemId: string): string {
    return `kitchen-supplier-item-${stockItemId}`;
}

/**
 * One row of the supply-order builder (SUP3).
 *
 * Keyed by the stock item, which is what a proposal row *is*: the row for a shelf that ran out and
 * the row for the same shelf somebody added by hand are the same row, deduped by the server, and a
 * key derived from the origin would have made that provable only by accident.
 */
export function supplyOrderRowTestId(stockItemId: string): string {
    return `kitchen-supply-order-row-${stockItemId}`;
}

/** One supplier's block in the builder's grouping preview (SUP3). */
export function supplyOrderGroupTestId(supplierId: string): string {
    return `kitchen-supply-order-group-${supplierId}`;
}

/**
 * One row of the order book (SUP4).
 *
 * Keyed by the order's identifier rather than by its `number`: the number is the handle a person
 * quotes down a phone line and is minted per organisation, while a test id has to be unique in a
 * page that may show two kitchens' fixtures in one Playwright run.
 */
export function purchaseOrderRowTestId(purchaseOrderId: string): string {
    return `kitchen-purchase-order-${purchaseOrderId}`;
}

/** One line on the purchase-order detail (SUP4), keyed by the shelf the line names. */
export function purchaseOrderLineTestId(stockItemId: string): string {
    return `kitchen-purchase-order-line-${stockItemId}`;
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
