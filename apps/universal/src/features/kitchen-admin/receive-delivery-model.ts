import type {
    GoodsReceiptLineInput,
    PostGoodsReceiptRequest,
    ReceivableOrder,
    ReceivableOrderLine,
} from '@healthy360/api-client/contracts';
import { PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import type { BranchId } from '@healthy360/domain-types';

import { trimDecimal } from './format.ts';

/**
 * The receive screen's arithmetic, as pure functions (SUP5, §4).
 *
 * Everything here is decidable from the rows on screen — what is outstanding, whether this delivery
 * is short, whether it is over, and what the request body ends up being — and none of it renders.
 * That is the same split `supply-order-model.ts` draws, for the same reason: the interesting
 * mistakes in a receiving form are arithmetic, and arithmetic is far cheaper to test than a tree.
 *
 * ## A blank quantity means "did not arrive", not "invalid"
 *
 * §4 prefills every ordered line with its **outstanding** quantity and lets a person reduce it for a
 * partial delivery. Zero is how a row says the item was not on the van, and it is excluded from the
 * post rather than refused: a delivery of three of the five things ordered is the ordinary case, not
 * a form error. A blank field reads the same way — somebody clearing a box means nothing arrived,
 * and demanding they type `0` would be the form arguing with them.
 *
 * ## Outstanding is read, never recomputed
 *
 * The server floors `outstandingQuantity` at zero and expresses all three quantities in the line's
 * own unit. Recomputing "ordered minus received" here would be a second answer to a question the
 * receiving guard has already answered, and the two would eventually disagree about a delivery
 * quoted per kilogram against a shelf counted in grams. This module compares against the server's
 * figure and nothing else.
 *
 * ## Scanning (ingredient barcodes, plan §8)
 *
 * A scan adds one pack to a row, and records off the pack what arrived: the product's GTIN, the
 * supplier lot and its two dates. The rules are here, generic over both screens' rows, so the
 * market-purchase form and the receive-against-order form count a scan the same way:
 *
 * 1. a scan-counted row on that shelf (and order line) with the **identical** GTIN, lot, expiry and
 *    best-before takes one more pack;
 * 2. otherwise, against an order, the line's **untouched prefill** is converted — its quantity
 *    becomes one pack, the outstanding figure is dropped rather than added to;
 * 3. otherwise a new scan-counted row is added, copying the order line, its unit and its price;
 * 4. a quantity somebody **typed** is never edited by a scan — the scan lands on its own row and
 *    the grouped check below flags any double count;
 * 5. a lot that matches with different dates is a new row, and says so.
 *
 * One pack is the code's pack size only when its unit **equals** the row's unit — the client has
 * no unit ratios and never converts. Otherwise the row is left empty for a person to type.
 */

/** Where a row's quantity came from: the order's outstanding prefill, a person, or a scanner. */
export type QuantitySource = 'prefill' | 'typed' | 'scanned';

/** What a scan writes on a row beside its quantity — the same fields on both screens' rows. */
export interface ScanTrace {
    /** The product scanned, fourteen digits. */
    readonly gtin?: string | null | undefined;
    readonly supplierLot?: string | undefined;
    /** `YYYY-MM-DD`, GS1 (17). */
    readonly expiresOn?: string | undefined;
    /** `YYYY-MM-DD`, GS1 (15). */
    readonly bestBeforeOn?: string | undefined;
    readonly quantitySource?: QuantitySource | undefined;
    /**
     * The lot was read to the end of a scan with no separator, so where it ends is not proven
     * (plan §5). The row cannot post until a person ticks {@link lotConfirmed} or edits the lot.
     */
    readonly lotUnverified?: boolean | undefined;
    readonly lotConfirmed?: boolean | undefined;
}

/** The part of a row a scan reads: its key, its shelf, its order line and its quantity. */
export interface ScannableDraft extends ScanTrace {
    readonly key: string;
    readonly stockItemId: string | null;
    readonly purchaseOrderLineId?: string | null | undefined;
    readonly quantity: string;
    /** What the order line still had to come, in its own unit — read, never recomputed. */
    readonly outstandingQuantity?: string | undefined;
}

/** One scan, resolved to the shelf it lands on. */
export interface ScannedPack {
    readonly stockItemId: string;
    readonly gtin: string;
    readonly supplierLot: string | null;
    readonly expiresOn: string | null;
    readonly bestBeforeOn: string | null;
    readonly boundaryVerified: boolean;
    /** One scan of the code, when the code has a pack size. */
    readonly packQuantity: string | null;
    readonly packUnitCode: string | null;
}

export interface ScanPlacement<Draft> {
    readonly drafts: readonly Draft[];
    /** The row the scan landed on. */
    readonly key: string;
    /** The pack could not be counted — no pack size, or another unit — so the quantity is a person's. */
    readonly needsQuantity: boolean;
    /** The same lot arrived with other dates and was kept on its own row. */
    readonly keptApart: boolean;
}

function scanTrace(scan: ScannedPack): Required<Omit<ScanTrace, 'quantitySource'>> {
    return {
        gtin: scan.gtin,
        supplierLot: scan.supplierLot ?? '',
        expiresOn: scan.expiresOn ?? '',
        bestBeforeOn: scan.bestBeforeOn ?? '',
        // Any field read to the end of a separator-free scan — the lot, or a serial that swallowed
        // it — needs a person to look at the pack before the line posts.
        lotUnverified: !scan.boundaryVerified,
        lotConfirmed: false,
    };
}

function sameProductAndLot(draft: ScanTrace, scan: ScannedPack): boolean {
    return (
        (draft.gtin ?? null) === scan.gtin && (draft.supplierLot ?? '') === (scan.supplierLot ?? '')
    );
}

function sameTrace(draft: ScanTrace, scan: ScannedPack): boolean {
    return (
        sameProductAndLot(draft, scan) &&
        (draft.expiresOn ?? '') === (scan.expiresOn ?? '') &&
        (draft.bestBeforeOn ?? '') === (scan.bestBeforeOn ?? '')
    );
}

/** Four places, as the columns hold, without a binary-fraction tail. */
function addQuantities(left: string, right: string): string {
    return trimDecimal(((readQuantity(left) ?? 0) + Number(right)).toFixed(4));
}

/**
 * Lands one scan on the rows (the rules in this module's header). `create` builds the base of a new
 * row: from `template` — the order line's own row, carrying its line, unit and price — or, with no
 * template, a fresh row for the shelf.
 */
export function applyScan<Draft extends ScannableDraft>(
    drafts: readonly Draft[],
    scan: ScannedPack,
    options: {
        readonly orderMode: boolean;
        /** The unit code a row's quantity is in. */
        readonly unitOf: (draft: Draft) => string | null;
        readonly create: (template: Draft | null) => Draft;
    },
): ScanPlacement<Draft> {
    const onShelf = drafts.filter((draft) => draft.stockItemId === scan.stockItemId);
    const template = options.orderMode
        ? (onShelf.find((draft) => (draft.purchaseOrderLineId ?? null) !== null) ?? null)
        : null;
    const lineId = template?.purchaseOrderLineId ?? null;
    const candidates = onShelf.filter(
        (draft) => !options.orderMode || (draft.purchaseOrderLineId ?? null) === lineId,
    );
    const packFits = (draft: Draft): boolean =>
        scan.packQuantity !== null &&
        scan.packUnitCode !== null &&
        scan.packUnitCode === options.unitOf(draft);
    const onePack = scan.packQuantity === null ? '' : trimDecimal(scan.packQuantity);
    const replace = (next: Draft): readonly Draft[] =>
        drafts.map((draft) => (draft.key === next.key ? next : draft));

    const match = candidates.find(
        (draft) => draft.quantitySource === 'scanned' && sameTrace(draft, scan),
    );
    if (match !== undefined) {
        if (!packFits(match)) {
            return { drafts, key: match.key, needsQuantity: true, keptApart: false };
        }
        const next: Draft = { ...match, quantity: addQuantities(match.quantity, onePack) };
        return { drafts: replace(next), key: match.key, needsQuantity: false, keptApart: false };
    }

    const prefill = options.orderMode
        ? candidates.find(
              (draft) =>
                  draft.quantitySource === 'prefill' &&
                  (draft.gtin ?? null) === null &&
                  (draft.supplierLot ?? '') === '' &&
                  (draft.expiresOn ?? '') === '' &&
                  (draft.bestBeforeOn ?? '') === '',
          )
        : undefined;
    if (prefill !== undefined) {
        const fits = packFits(prefill);
        const next: Draft = {
            ...prefill,
            ...scanTrace(scan),
            quantitySource: 'scanned',
            quantity: fits ? onePack : '',
        };
        return { drafts: replace(next), key: next.key, needsQuantity: !fits, keptApart: false };
    }

    const keptApart = candidates.some(
        (draft) => draft.quantitySource === 'scanned' && sameProductAndLot(draft, scan),
    );
    const base = options.create(template);
    const fits = packFits(base);
    const created: Draft = {
        ...base,
        ...scanTrace(scan),
        quantitySource: 'scanned',
        quantity: fits ? onePack : '',
    };
    return { drafts: [...drafts, created], key: created.key, needsQuantity: !fits, keptApart };
}

/** GS1 AI (10): at most 20 characters of the GS1 set — what the server accepts. Blank is fine. */
export function lotIsReadable(lot: string | undefined): boolean {
    return /^[!"%&'()*+,\-./0-9:;<=>?A-Z_a-z]{0,20}$/.test((lot ?? '').trim());
}

/** A lot that still needs a person to say it was read right. */
export function lotCheckPending(line: ScanTrace): boolean {
    return line.lotUnverified === true && line.lotConfirmed !== true;
}

/** The traceability a row sends, each field only when it is set. */
export function traceInput(line: ScanTrace): {
    readonly gtin?: string;
    readonly supplierLot?: string;
    readonly expiresOn?: string;
    readonly bestBeforeOn?: string;
} {
    const set = (value: string | null | undefined): string | null =>
        value === null || value === undefined || value.trim() === '' ? null : value.trim();
    const gtin = set(line.gtin);
    const supplierLot = set(line.supplierLot);
    const expiresOn = set(line.expiresOn);
    const bestBeforeOn = set(line.bestBeforeOn);

    return {
        ...(gtin === null ? {} : { gtin }),
        ...(supplierLot === null ? {} : { supplierLot }),
        ...(expiresOn === null ? {} : { expiresOn }),
        ...(bestBeforeOn === null ? {} : { bestBeforeOn }),
    };
}

/**
 * Each order line's rows summed, all in the line's own unit. Two lots of 5 against 10 outstanding is
 * ten, which is neither short nor over; comparing row by row would call both rows short.
 */
export function orderLineTotals(
    lines: readonly ScannableDraft[],
): ReadonlyMap<string, { readonly received: number; readonly outstanding: number }> {
    const totals = new Map<string, { received: number; outstanding: number }>();
    for (const line of lines) {
        const id = line.purchaseOrderLineId ?? null;
        if (id === null) continue;
        const current = totals.get(id);
        totals.set(id, {
            received: (current?.received ?? 0) + (readQuantity(line.quantity) ?? 0),
            outstanding: Number(line.outstandingQuantity ?? '0'),
        });
    }
    return totals;
}

/** One row of the receive form, before it becomes a request line. */
export interface ReceiveLineDraft extends ScannableDraft {
    /** `null` for an unplanned extra item — something on the van nobody ordered (§4). */
    readonly purchaseOrderLineId: string | null;
    readonly stockItemId: string;
    readonly itemLabel: string;
    readonly unitCode: string;
    readonly unitId: string | null;
    /** The server's figures, carried through so nothing is recomputed from them. */
    readonly orderedQuantity: string;
    readonly outstandingQuantity: string;
    /** What the person says arrived. Blank or zero means nothing did. */
    readonly quantity: string;
    /** Major-unit price per {@link unitCode}. Blank means the invoice has not arrived. */
    readonly unitPrice: string;
}

/** The two explicit confirmations §3.5 requires, plus the notes they carry. */
export interface ReceiveConfirmations {
    readonly overReceiptConfirmed: boolean;
    readonly varianceNote: string;
    readonly closeShort: boolean;
    readonly closeShortReason: string;
}

/** Everything the header of the form holds. */
export interface ReceiveHeaderDraft {
    readonly receivedOn: string;
    readonly documentRef: string;
    readonly supplierInvoiceRef: string;
    readonly invoiceDate: string;
    readonly discountAmount: string;
    readonly taxAmount: string;
    readonly deliveryAmount: string;
    readonly otherChargesAmount: string;
    readonly invoiceTotalAmount: string;
}

/** What the confirmation dialog and the submit button need to know about a draft. */
export interface ReceiveReadiness {
    /** Rows that will actually be posted — everything above zero. */
    readonly deliveredLineCount: number;
    /** Rows left at zero. Named in the confirmation so nobody wonders where they went. */
    readonly skippedLineCount: number;
    /** At least one row is delivering more than the order still has outstanding. */
    readonly hasOverReceipt: boolean;
    /** At least one row is delivering less than its outstanding quantity. */
    readonly hasShortfall: boolean;
    /** At least one scanned lot is waiting for a person to confirm it was read right. */
    readonly needsLotCheck: boolean;
    /** At least one row was added by hand and belongs to no ordered line (§4). */
    readonly hasUnplannedLine: boolean;
    /** A note is required — for an over-receipt, or for an unplanned item. */
    readonly needsVarianceNote: boolean;
    /** The close-short box is ticked and its reason is still blank. */
    readonly needsCloseShortReason: boolean;
    /** Every gate above is satisfied and there is something to post. */
    readonly canSubmit: boolean;
}

/**
 * A quantity as typed, or `null` when the box is empty or unreadable.
 *
 * A plain decimal only. `1e3` and `+2` are numeric to JavaScript and neither is a quantity anybody
 * typed into a kitchen form, and the server's own guard uses the same shape.
 */
export function readQuantity(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return null;
    return Number(trimmed);
}

/** A price as typed, or `null` when the box is empty or unreadable. Six places, as the columns hold. */
export function readAmount(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
    return Number(trimmed);
}

/** Rounded to the four places the columns hold, so a sum of decimals compares honestly. */
function fourPlaces(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

/**
 * Whether a row's order line is receiving more than it still has outstanding — summed over every
 * row on that line (`lines`), since a second lot is a second row of the same line.
 */
export function exceedsOutstanding(
    line: ScannableDraft,
    lines: readonly ScannableDraft[] = [line],
): boolean {
    const id = line.purchaseOrderLineId ?? null;
    if (id === null) return false;
    const total = orderLineTotals(lines).get(id);
    return total !== undefined && fourPlaces(total.received) > fourPlaces(total.outstanding);
}

/** Whether a row's order line is receiving less than it still has outstanding, summed over its rows. */
export function fallsShort(
    line: ScannableDraft,
    lines: readonly ScannableDraft[] = [line],
): boolean {
    const id = line.purchaseOrderLineId ?? null;
    if (id === null) return false;
    const total = orderLineTotals(lines).get(id);
    return total !== undefined && fourPlaces(total.received) < fourPlaces(total.outstanding);
}

/**
 * Every ordered line, prefilled with what is **still to come** (§4).
 *
 * Fully delivered lines are kept and prefilled with zero rather than dropped: a person checking a
 * pallet against a sheet needs to see the row accounted for rather than absent, and a row that
 * quietly disappeared would read as a mistake in the order.
 */
export function initialLines(order: ReceivableOrder): readonly ReceiveLineDraft[] {
    return order.lines.map((line: ReceivableOrderLine) => ({
        key: `order-line-${line.purchaseOrderLineId}`,
        purchaseOrderLineId: line.purchaseOrderLineId,
        stockItemId: String(line.stockItemId),
        itemLabel: `${line.itemCode} — ${line.itemNameEn}`,
        unitCode: line.unitCode,
        unitId: line.unitId,
        orderedQuantity: trimDecimal(line.orderedQuantity),
        outstandingQuantity: trimDecimal(line.outstandingQuantity),
        quantity: Number(line.outstandingQuantity) > 0 ? trimDecimal(line.outstandingQuantity) : '',
        unitPrice: '',
        quantitySource: 'prefill' as const,
    }));
}

/** Everything the submit button and the confirmation dialog read off a draft. */
export function readiness(
    lines: readonly ReceiveLineDraft[],
    confirmations: ReceiveConfirmations,
    againstOrder: boolean,
): ReceiveReadiness {
    const delivered = lines.filter((line) => (readQuantity(line.quantity) ?? 0) > 0);
    const hasOverReceipt = lines.some((line) => exceedsOutstanding(line, lines));
    const hasShortfall = lines.some((line) => fallsShort(line, lines));
    // Only rows that will post: a row left at nothing is dropped from the request anyway.
    const needsLotCheck = delivered.some(lotCheckPending);
    const everyLotReadable = delivered.every((line) => lotIsReadable(line.supplierLot));
    const hasUnplannedLine = againstOrder && delivered.some((l) => l.purchaseOrderLineId === null);

    const noteBlank = confirmations.varianceNote.trim() === '';
    const needsVarianceNote = (hasOverReceipt || hasUnplannedLine) && noteBlank;
    const needsCloseShortReason =
        confirmations.closeShort && confirmations.closeShortReason.trim() === '';

    // A row typed as `2.55555` reads back as null, and a form that posted the rest of the delivery
    // while silently dropping it would lose stock nobody could reconcile.
    const everyQuantityReadable = lines.every(
        (line) => line.quantity.trim() === '' || readQuantity(line.quantity) !== null,
    );
    const everyPriceReadable = lines.every(
        (line) => line.unitPrice.trim() === '' || readAmount(line.unitPrice) !== null,
    );

    return {
        deliveredLineCount: delivered.length,
        skippedLineCount: lines.length - delivered.length,
        hasOverReceipt,
        hasShortfall,
        needsLotCheck,
        hasUnplannedLine,
        needsVarianceNote,
        needsCloseShortReason,
        canSubmit:
            delivered.length > 0 &&
            everyQuantityReadable &&
            everyPriceReadable &&
            everyLotReadable &&
            !needsVarianceNote &&
            !needsCloseShortReason &&
            !needsLotCheck &&
            (!hasOverReceipt || confirmations.overReceiptConfirmed),
    };
}

/** The header and confirmation fields a receive form submits, resolved. */
export interface ReceivePayloadContext {
    readonly branchId: BranchId;
    readonly supplierId: string | null;
    readonly purchaseOrderId: string | null;
    readonly currencyCode: string;
    readonly header: ReceiveHeaderDraft;
    readonly confirmations: ReceiveConfirmations;
}

/**
 * The request body, built from exactly what is on screen.
 *
 * Rows at zero are left out — that is what "did not arrive" means — and a row with no price is sent
 * as a quantity only, which puts the receipt in the unpriced queue rather than inventing a figure.
 * Every optional field is omitted when blank rather than sent as an empty string, because the server
 * treats presence as meaning.
 */
export function toReceiptPayload(
    lines: readonly ReceiveLineDraft[],
    context: ReceivePayloadContext,
): PostGoodsReceiptRequest {
    const { header, confirmations } = context;

    const payloadLines: GoodsReceiptLineInput[] = [];

    for (const line of lines) {
        const quantity = readQuantity(line.quantity);
        if (quantity === null || quantity <= 0) continue;

        const price = readAmount(line.unitPrice);

        payloadLines.push({
            stockItemId: StockItemId.unsafe(line.stockItemId),
            quantity,
            ...(line.purchaseOrderLineId === null
                ? {}
                : { purchaseOrderLineId: line.purchaseOrderLineId }),
            ...(line.unitId === null ? {} : { unitId: line.unitId }),
            ...(price === null
                ? {}
                : { unitPriceAmount: price, costCurrencyCode: context.currencyCode }),
            ...traceInput(line),
        });
    }

    const trimmedOr = (value: string): string | null => (value.trim() === '' ? null : value.trim());

    return {
        branchId: context.branchId,
        supplierId: context.supplierId === null ? null : SupplierId.unsafe(context.supplierId),
        purchaseOrderId:
            context.purchaseOrderId === null
                ? null
                : PurchaseOrderId.unsafe(context.purchaseOrderId),
        receivedOn: trimmedOr(header.receivedOn),
        documentRef: trimmedOr(header.documentRef),
        supplierInvoiceRef: trimmedOr(header.supplierInvoiceRef),
        invoiceDate: trimmedOr(header.invoiceDate),
        varianceNote: trimmedOr(confirmations.varianceNote),
        ...(readAmount(header.discountAmount) === null
            ? {}
            : { discountAmount: readAmount(header.discountAmount) as number }),
        ...(readAmount(header.taxAmount) === null
            ? {}
            : { taxAmount: readAmount(header.taxAmount) as number }),
        ...(readAmount(header.deliveryAmount) === null
            ? {}
            : { deliveryAmount: readAmount(header.deliveryAmount) as number }),
        ...(readAmount(header.otherChargesAmount) === null
            ? {}
            : { otherChargesAmount: readAmount(header.otherChargesAmount) as number }),
        ...(readAmount(header.invoiceTotalAmount) === null
            ? {}
            : { invoiceTotalAmount: readAmount(header.invoiceTotalAmount) as number }),
        overReceiptConfirmed: confirmations.overReceiptConfirmed,
        closeShort: confirmations.closeShort,
        closeShortReason: trimmedOr(confirmations.closeShortReason),
        lines: payloadLines,
    };
}

/** Today at the reader's own clock, `YYYY-MM-DD` — the honest default for a delivery date. */
export function todayIsoDate(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
