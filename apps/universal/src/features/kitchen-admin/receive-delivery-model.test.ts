import type { ReceivableOrder } from '@healthy360/api-client/contracts';
import { BranchId, PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';

import {
    canReceivePurchaseOrder,
    receiptCostStatusKey,
    receiptCostStatusTone,
} from './ops-format.ts';
import {
    exceedsOutstanding,
    fallsShort,
    initialLines,
    readAmount,
    readQuantity,
    readiness,
    toReceiptPayload,
    todayIsoDate,
} from './receive-delivery-model.ts';
import type { ReceiveConfirmations, ReceiveHeaderDraft } from './receive-delivery-model.ts';

/*
 * The receive form's arithmetic (SUP5, §4).
 *
 * Every claim here is one a screen test could only make expensively and a person could only catch
 * by receiving a real delivery wrong. Three of them are the ones §3.5 and §4 turn on:
 *
 * - a row prefills with what is **outstanding**, never with what was originally ordered;
 * - an over-receipt is refused until somebody confirms it *and* says why — the confirmation records
 *   that they clicked, the note records what they knew;
 * - a partial delivery offers to close the rest of the order, and that needs its own reason.
 *
 * The fourth is quieter and is where a form loses stock: a quantity typed as `2.55555` reads back
 * as unusable, and a payload that posted the rest of the delivery while silently dropping that row
 * would leave a shelf nobody can reconcile. The draft refuses to submit instead.
 */

const BRANCH = BranchId.unsafe('01935f6d-0000-7000-8000-0000000000b1');
const SUPPLIER = SupplierId.unsafe('01935f6d-0000-7000-8000-0000000000s1');
const ORDER = PurchaseOrderId.unsafe('01935f6d-0000-7000-8000-0000000000o1');

function order(overrides: Partial<ReceivableOrder> = {}): ReceivableOrder {
    return {
        id: ORDER,
        number: 'PO-ABCDEF01',
        status: 'issued',
        branchId: BRANCH,
        supplier: { id: SUPPLIER, code: 'SUP-01', nameEn: 'Gulf Fresh' },
        issuedAt: '2026-08-17T09:00:00+00:00',
        lineCount: 2,
        outstandingLineCount: 2,
        lines: [
            {
                purchaseOrderLineId: 'line-1',
                stockItemId: StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000i1'),
                itemCode: 'FLR-1',
                itemNameEn: 'Flour',
                itemNameAr: null,
                unitCode: 'kg',
                unitId: 'unit-kg',
                orderedQuantity: '10.0000',
                receivedQuantity: '4.0000',
                outstandingQuantity: '6.0000',
            },
            {
                purchaseOrderLineId: 'line-2',
                stockItemId: StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000i2'),
                itemCode: 'SUG-1',
                itemNameEn: 'Sugar',
                itemNameAr: null,
                unitCode: 'kg',
                unitId: 'unit-kg',
                orderedQuantity: '5.0000',
                receivedQuantity: '5.0000',
                outstandingQuantity: '0.0000',
            },
        ],
        ...overrides,
    };
}

const NO_CONFIRMATIONS: ReceiveConfirmations = {
    overReceiptConfirmed: false,
    varianceNote: '',
    closeShort: false,
    closeShortReason: '',
};

const HEADER: ReceiveHeaderDraft = {
    receivedOn: '2026-08-18',
    documentRef: 'DN-77',
    supplierInvoiceRef: '',
    invoiceDate: '',
    discountAmount: '',
    taxAmount: '',
    deliveryAmount: '',
    otherChargesAmount: '',
    invoiceTotalAmount: '',
};

describe('readQuantity', () => {
    it('reads a plain decimal and refuses anything a person did not type into a kitchen form', () => {
        expect(readQuantity('4')).toBe(4);
        expect(readQuantity('0.125')).toBe(0.125);
        expect(readQuantity('')).toBeNull();
        expect(readQuantity('  ')).toBeNull();
        // Numeric to JavaScript, and none of them a quantity anybody typed.
        expect(readQuantity('1e3')).toBeNull();
        expect(readQuantity('+2')).toBeNull();
        expect(readQuantity('-1')).toBeNull();
        // Beyond the column's four places — the server refuses it, so the form does too.
        expect(readQuantity('2.55555')).toBeNull();
    });

    it('reads a price to six places, matching the money columns', () => {
        expect(readAmount('2.000001')).toBe(2.000001);
        expect(readAmount('2.0000001')).toBeNull();
    });
});

describe('initialLines', () => {
    it('prefills each row with what is still to come, not with what was ordered', () => {
        const lines = initialLines(order());

        expect(lines[0]?.quantity).toBe('6.0000');
        expect(lines[0]?.orderedQuantity).toBe('10.0000');
        // A fully delivered line stays on the form so a person checking a pallet can see the row
        // accounted for — but it opens at nothing, because nothing is outstanding.
        expect(lines[1]?.quantity).toBe('');
        expect(lines[1]?.outstandingQuantity).toBe('0.0000');
    });

    it('carries the order line and its unit through, so a delivery cannot be counted in something else', () => {
        const lines = initialLines(order());

        expect(lines[0]?.purchaseOrderLineId).toBe('line-1');
        expect(lines[0]?.unitCode).toBe('kg');
        expect(lines[0]?.unitId).toBe('unit-kg');
    });
});

describe('over-receipt', () => {
    it('triggers when a row exceeds what the order still has outstanding', () => {
        const lines = initialLines(order());
        const over = [{ ...lines[0]!, quantity: '7' }, lines[1]!];

        expect(exceedsOutstanding(over[0]!)).toBe(true);
        expect(exceedsOutstanding({ ...lines[0]!, quantity: '6' })).toBe(false);
        // An unplanned row has no ordered quantity to exceed.
        expect(
            exceedsOutstanding({ ...lines[0]!, purchaseOrderLineId: null, quantity: '99' }),
        ).toBe(false);
    });

    it('blocks the post until it is confirmed and explained', () => {
        const lines = [{ ...initialLines(order())[0]!, quantity: '7' }];

        const unconfirmed = readiness(lines, NO_CONFIRMATIONS, true);
        expect(unconfirmed.hasOverReceipt).toBe(true);
        expect(unconfirmed.canSubmit).toBe(false);

        // §3.5 asks for both. A tick with no sentence is still refused.
        const tickedOnly = readiness(
            lines,
            { ...NO_CONFIRMATIONS, overReceiptConfirmed: true },
            true,
        );
        expect(tickedOnly.needsVarianceNote).toBe(true);
        expect(tickedOnly.canSubmit).toBe(false);

        const explained = readiness(
            lines,
            { ...NO_CONFIRMATIONS, overReceiptConfirmed: true, varianceNote: 'Next size up.' },
            true,
        );
        expect(explained.canSubmit).toBe(true);
    });
});

describe('short delivery', () => {
    it('recognises a shortfall and requires a reason once closing the rest is asked for', () => {
        const lines = [{ ...initialLines(order())[0]!, quantity: '2' }];

        const partial = readiness(lines, NO_CONFIRMATIONS, true);
        expect(fallsShort(lines[0]!)).toBe(true);
        expect(partial.hasShortfall).toBe(true);
        // A part delivery on its own is ordinary and posts freely.
        expect(partial.canSubmit).toBe(true);

        const closing = readiness(lines, { ...NO_CONFIRMATIONS, closeShort: true }, true);
        expect(closing.needsCloseShortReason).toBe(true);
        expect(closing.canSubmit).toBe(false);

        const closingWithReason = readiness(
            lines,
            { ...NO_CONFIRMATIONS, closeShort: true, closeShortReason: 'Pack discontinued.' },
            true,
        );
        expect(closingWithReason.canSubmit).toBe(true);
    });
});

describe('unplanned items', () => {
    it('needs a note before an item nobody ordered can ride along', () => {
        const lines = [
            { ...initialLines(order())[0]!, quantity: '6' },
            {
                purchaseOrderLineId: null,
                stockItemId: '01935f6d-0000-7000-8000-0000000000i9',
                itemLabel: 'PKG-1 — Boxes',
                unitCode: 'piece',
                unitId: null,
                orderedQuantity: '0',
                outstandingQuantity: '0',
                quantity: '50',
                unitPrice: '',
            },
        ];

        expect(readiness(lines, NO_CONFIRMATIONS, true).hasUnplannedLine).toBe(true);
        expect(readiness(lines, NO_CONFIRMATIONS, true).canSubmit).toBe(false);
        expect(
            readiness(lines, { ...NO_CONFIRMATIONS, varianceNote: 'Chased last week.' }, true)
                .canSubmit,
        ).toBe(true);
    });
});

describe('readiness', () => {
    it('counts what will post and what is being left out', () => {
        const lines = initialLines(order());
        const state = readiness(lines, NO_CONFIRMATIONS, true);

        expect(state.deliveredLineCount).toBe(1);
        expect(state.skippedLineCount).toBe(1);
    });

    it('refuses to post while any row is unreadable, rather than dropping it', () => {
        const lines = [{ ...initialLines(order())[0]!, quantity: '2.55555' }];
        expect(readiness(lines, NO_CONFIRMATIONS, true).canSubmit).toBe(false);

        const badPrice = [{ ...initialLines(order())[0]!, quantity: '6', unitPrice: 'two' }];
        expect(readiness(badPrice, NO_CONFIRMATIONS, true).canSubmit).toBe(false);
    });

    it('refuses an empty delivery — nothing arrived is not a receipt', () => {
        const lines = initialLines(order()).map((line) => ({ ...line, quantity: '' }));
        expect(readiness(lines, NO_CONFIRMATIONS, true).canSubmit).toBe(false);
    });
});

describe('toReceiptPayload', () => {
    it('posts only the rows that arrived, with their order lines attached', () => {
        const lines = initialLines(order());
        const payload = toReceiptPayload(lines, {
            branchId: BRANCH,
            supplierId: String(SUPPLIER),
            purchaseOrderId: String(ORDER),
            currencyCode: 'USD',
            header: HEADER,
            confirmations: NO_CONFIRMATIONS,
        });

        expect(payload.lines).toHaveLength(1);
        expect(payload.lines[0]?.purchaseOrderLineId).toBe('line-1');
        expect(payload.lines[0]?.quantity).toBe(6);
        expect(payload.lines[0]?.unitId).toBe('unit-kg');
        // No price typed: a quantity-only line, which is what puts a receipt in the queue.
        expect(payload.lines[0]?.unitPriceAmount).toBeUndefined();
        expect(payload.purchaseOrderId).toBe(String(ORDER));
        expect(payload.receivedOn).toBe('2026-08-18');
        expect(payload.documentRef).toBe('DN-77');
    });

    it('sends a price with its currency, and omits blank optional fields rather than emptying them', () => {
        const lines = [{ ...initialLines(order())[0]!, quantity: '6', unitPrice: '2.50' }];
        const payload = toReceiptPayload(lines, {
            branchId: BRANCH,
            supplierId: String(SUPPLIER),
            purchaseOrderId: String(ORDER),
            currencyCode: 'USD',
            header: { ...HEADER, deliveryAmount: '3', invoiceTotalAmount: '18' },
            confirmations: { ...NO_CONFIRMATIONS, closeShort: true, closeShortReason: 'Done.' },
        });

        expect(payload.lines[0]?.unitPriceAmount).toBe(2.5);
        expect(payload.lines[0]?.costCurrencyCode).toBe('USD');
        expect(payload.deliveryAmount).toBe(3);
        expect(payload.invoiceTotalAmount).toBe(18);
        // Absent rather than an empty string: the server treats presence as meaning.
        expect(payload.taxAmount).toBeUndefined();
        expect(payload.supplierInvoiceRef).toBeNull();
        expect(payload.closeShort).toBe(true);
        expect(payload.closeShortReason).toBe('Done.');
    });
});

describe('todayIsoDate', () => {
    it('formats a local calendar day, never a UTC instant', () => {
        // Late evening on the 18th in a zone ahead of UTC is still the 18th to the person typing.
        expect(todayIsoDate(new Date(2026, 7, 18, 23, 30))).toBe('2026-08-18');
        expect(todayIsoDate(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
    });
});

describe('receiving capabilities and badges', () => {
    it('offers the receive action on exactly the two states a van can arrive against', () => {
        expect(canReceivePurchaseOrder('draft')).toBe(false);
        expect(canReceivePurchaseOrder('issued')).toBe(true);
        expect(canReceivePurchaseOrder('partially_received')).toBe(true);
        expect(canReceivePurchaseOrder('received')).toBe(false);
        expect(canReceivePurchaseOrder('cancelled')).toBe(false);
    });

    it('tones both unfinished costing states as work rather than as faults', () => {
        expect(receiptCostStatusTone('unpriced')).toBe('warning');
        expect(receiptCostStatusTone('partial')).toBe('warning');
        expect(receiptCostStatusTone('complete')).toBe('success');

        expect(receiptCostStatusKey('unpriced')).toBe('kitchen:ops.receiving.costStatus.unpriced');
        expect(receiptCostStatusKey('complete')).toBe('kitchen:ops.receiving.costStatus.complete');
    });
});
