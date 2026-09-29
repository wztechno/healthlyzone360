import type {
    CreateQualityCheckRequest,
    GoodsReceipt,
    ProcurementReference,
    QualityCheck,
    StockItem,
} from '@healthy360/api-client/contracts';
import { GoodsReceiptId, QualityCheckId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { QualityControlScreen } from './screens/quality-control-screen.tsx';

/**
 * Opening a quality check (the Post Receipt design's `qc` screen), against a world this file
 * authors.
 *
 * 1. **The subject is picked, not typed.** The branch's receipts are listed by the words on their
 *    paperwork; pressing Open check with none picked says so and sends nothing.
 * 2. **Picking one shows what a hold would stop**, and a subject with a check still open is flagged
 *    with a way to that check.
 * 3. **"On hold now" is the create and then the hold**, in that order, on the check just made.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        setParams: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/kitchen/qc',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

async function press(testID: string) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

/* ------------------------------------------------------------------------------------------------
 * The world
 * ---------------------------------------------------------------------------------------------- */

const CHICKEN = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b1');
const LABNEH = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b2');
const FRESH = '01935f6d-0000-7000-8000-0000000000d1';
const DAIRY = '01935f6d-0000-7000-8000-0000000000d2';
const HELD_CHECK = QualityCheckId.unsafe('01935f6d-0000-7000-8000-0000000000f1');
const NEW_CHECK = QualityCheckId.unsafe('01935f6d-0000-7000-8000-0000000000f2');

function shelf(id: StockItemId, nameEn: string): StockItem {
    return {
        id,
        code: 'ING',
        nameEn,
        unitCode: 'kg',
        ingredientId: null,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: true,
        hasHistory: true,
    };
}

function receipt(
    id: string,
    documentRef: string,
    supplierName: string,
    receivedOn: string,
    lines: readonly [StockItemId, string][],
): GoodsReceipt {
    return {
        id: GoodsReceiptId.unsafe(id),
        branchId: TEST_BRANCH_ID,
        supplier: {
            id: SupplierId.unsafe(`${id.slice(0, -2)}a1`),
            code: 'SUP',
            nameEn: supplierName,
        },
        documentRef,
        supplierInvoiceRef: null,
        invoiceDate: null,
        varianceNote: null,
        purchaseOrderId: null,
        receivedAt: `${receivedOn}T09:00:00Z`,
        receivedOn,
        costStatus: 'complete',
        unpricedLineCount: 0,
        valuationPendingCount: 0,
        currencyCode: 'USD',
        receiptTotalAmount: null,
        discountAmount: null,
        taxAmount: null,
        deliveryAmount: null,
        otherChargesAmount: null,
        invoiceTotalAmount: null,
        costsRedacted: false,
        lines: lines.map(([stockItemId, quantity], index) => ({
            id: `${id}-line-${String(index)}`,
            stockItemId,
            purchaseOrderLineId: null,
            quantity,
            unitId: null,
            unitPriceAmount: null,
            lineTotalAmount: null,
            costCurrencyCode: null,
            costedAt: null,
            valuationPendingFx: false,
        })),
    };
}

const REFERENCE: ProcurementReference = {
    currencies: [],
    defaultCurrencyCode: 'USD',
    measurementUnits: [],
};

const HELD: QualityCheck = {
    id: HELD_CHECK,
    subjectType: 'goods_receipt',
    subjectId: DAIRY,
    status: 'hold',
};

function world(created: CreateQualityCheckRequest[], held: string[]) {
    return {
        kitchenOps: {
            listQualityChecks: async () => [HELD],
            listGoodsReceipts: async () => [
                receipt(DAIRY, 'DN-2210', 'Tripoli Dairy', '2026-09-11', [[LABNEH, '12.0000']]),
                receipt(FRESH, 'DN-4471', 'Beqaa Fresh Produce', '2026-09-12', [
                    [CHICKEN, '24.0000'],
                    [LABNEH, '2.5000'],
                    [CHICKEN, '1.0000'],
                    [LABNEH, '3.0000'],
                ]),
            ],
            listStockItems: async () => [
                shelf(CHICKEN, 'Chicken breast, fresh'),
                shelf(LABNEH, 'Labneh, full fat'),
            ],
            getProcurementReference: async () => REFERENCE,
            createQualityCheck: async (request: CreateQualityCheckRequest) => {
                created.push(request);
                return { id: NEW_CHECK, status: 'pending' as const };
            },
            holdQualityCheck: async (id: string) => {
                held.push(id);
                return { id: NEW_CHECK, status: 'hold' as const };
            },
        },
    };
}

async function openEditor(created: CreateQualityCheckRequest[], held: string[]) {
    await renderStubScreen(<QualityControlScreen />, {
        session: kitchenManagerSession(),
        repositories: world(created, held),
    });
    await untilVisible('kitchen-qc-create');
    await press('kitchen-qc-create');
    await untilVisible(`kitchen-qc-subject-${FRESH}`);
}

/* ------------------------------------------------------------------------------------------------
 * The editor
 * ---------------------------------------------------------------------------------------------- */

describe('open a quality check', () => {
    it('refuses without a subject, then opens one on the receipt picked from the list', async () => {
        const created: CreateQualityCheckRequest[] = [];
        await openEditor(created, []);

        // Newest first, named by the delivery note.
        expect(screen.getByText('DN-4471')).toBeTruthy();
        expect(screen.getByTestId(`kitchen-qc-subject-${DAIRY}-check`)).toBeTruthy();

        await press('kitchen-qc-create-editor-save');
        await untilVisible('kitchen-qc-create-missing');
        expect(created).toHaveLength(0);

        await press(`kitchen-qc-subject-${FRESH}`);
        await untilVisible('kitchen-qc-create-cover');
        expect(screen.getAllByText('Chicken breast, fresh')).toHaveLength(2);
        expect(screen.getByText('24 kg')).toBeTruthy();
        // Three named, the fourth counted — a hold stops all four.
        expect(screen.getByTestId('kitchen-qc-create-cover-more')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-qc-create-duplicate')).toBeNull();

        await press('kitchen-qc-create-editor-save');
        await waitFor(() => {
            expect(created).toEqual([{ subjectType: 'goods_receipt', subjectId: FRESH }]);
        });
    });

    it('flags a subject whose check is still on hold, and offers that check', async () => {
        await openEditor([], []);

        await press(`kitchen-qc-subject-${DAIRY}`);
        await untilVisible('kitchen-qc-create-duplicate');

        await press('kitchen-qc-create-duplicate-open');
        await untilVisible('kitchen-qc-view');
    });

    it('opens and then holds when the check starts on hold', async () => {
        const created: CreateQualityCheckRequest[] = [];
        const held: string[] = [];
        await openEditor(created, held);

        await press(`kitchen-qc-subject-${FRESH}`);
        await untilVisible('kitchen-qc-start-hold');
        await press('kitchen-qc-start-hold');
        expect(screen.getAllByText('Open and hold').length).toBeGreaterThan(0);

        await press('kitchen-qc-create-editor-save');
        await waitFor(() => {
            expect(held).toEqual([NEW_CHECK]);
        });
        expect(created).toEqual([{ subjectType: 'goods_receipt', subjectId: FRESH }]);
    });
});
