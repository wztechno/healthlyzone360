import type {
    GoodsReceiptLineInput,
    PostGoodsReceiptRequest,
    ReceivableOrder,
    ReceivableOrderLine,
} from '@healthy360/api-client/contracts';
import { PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import type { BranchId } from '@healthy360/domain-types';

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
 */

/** One row of the receive form, before it becomes a request line. */
export interface ReceiveLineDraft {
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

/** Whether one row is delivering more than the order still has outstanding. */
export function exceedsOutstanding(line: ReceiveLineDraft): boolean {
    if (line.purchaseOrderLineId === null) return false;
    const quantity = readQuantity(line.quantity);
    if (quantity === null) return false;
    return quantity > Number(line.outstandingQuantity);
}

/** Whether one row is delivering less than the order still has outstanding. */
export function fallsShort(line: ReceiveLineDraft): boolean {
    if (line.purchaseOrderLineId === null) return false;
    return (readQuantity(line.quantity) ?? 0) < Number(line.outstandingQuantity);
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
        purchaseOrderLineId: line.purchaseOrderLineId,
        stockItemId: String(line.stockItemId),
        itemLabel: `${line.itemCode} — ${line.itemNameEn}`,
        unitCode: line.unitCode,
        unitId: line.unitId,
        orderedQuantity: line.orderedQuantity,
        outstandingQuantity: line.outstandingQuantity,
        quantity: Number(line.outstandingQuantity) > 0 ? line.outstandingQuantity : '',
        unitPrice: '',
    }));
}

/** Everything the submit button and the confirmation dialog read off a draft. */
export function readiness(
    lines: readonly ReceiveLineDraft[],
    confirmations: ReceiveConfirmations,
    againstOrder: boolean,
): ReceiveReadiness {
    const delivered = lines.filter((line) => (readQuantity(line.quantity) ?? 0) > 0);
    const hasOverReceipt = lines.some(exceedsOutstanding);
    const hasShortfall = lines.some(fallsShort);
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
        hasUnplannedLine,
        needsVarianceNote,
        needsCloseShortReason,
        canSubmit:
            delivered.length > 0 &&
            everyQuantityReadable &&
            everyPriceReadable &&
            !needsVarianceNote &&
            !needsCloseShortReason &&
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
