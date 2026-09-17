import type {
    GoodsReceipt,
    ProcurementReference,
    ProductionOrder,
    QualityCheck,
} from '@healthy360/api-client/contracts';
import {
    BranchId,
    GoodsReceiptId,
    ProductionOrderId,
    QualityCheckId,
    RecipeVersionId,
    StockItemId,
    SupplierId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    goodsReceiptRowTestId,
    productionOrderRowTestId,
    qualityCheckRowTestId,
} from './ops-format.ts';
import { ProcurementScreen } from './screens/procurement-screen.tsx';
import { ProductionScreen } from './screens/production-screen.tsx';
import { QualityControlScreen } from './screens/quality-control-screen.tsx';

/**
 * Every column header on the three whole-list operations tables — receipts, production orders and
 * quality checks — is a control: it sorts on the press or opens a value list.
 *
 * All three endpoints return the whole list with no page, so every header here sorts or narrows in
 * memory, and the Status / Prices headers share their state with the toolbar segments rather than
 * running a second, competing filter. The rows are authored in this file.
 */

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        setParams: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/kitchen/procurement',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

/** Waits for an element, with the contention headroom the other kitchen suites document. */
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

/*
 * Above `md` the Catalogue draws tracks with headers; Jest's default 750px window is below it, so the
 * window is widened for the suite, as the packaging suite does.
 */
const narrowWindow = Dimensions.get('window');
const narrowScreen = Dimensions.get('screen');

beforeAll(() => {
    Dimensions.set({
        window: { ...narrowWindow, width: 1440, height: 900 },
        screen: { ...narrowScreen, width: 1440, height: 900 },
    });
});

afterAll(() => {
    Dimensions.set({ window: narrowWindow, screen: narrowScreen });
});

/* ------------------------------------------------------------------------------------------------
 * Receipts
 * ---------------------------------------------------------------------------------------------- */

const SUPPLIER = SupplierId.unsafe('01935f6d-0000-7000-8000-0000000000a1');
const RECEIPT_PRICED = '01935f6d-0000-7000-8000-0000000000d1';
const RECEIPT_UNPRICED = '01935f6d-0000-7000-8000-0000000000d2';

function receipt(id: string, overrides: Partial<GoodsReceipt> = {}): GoodsReceipt {
    return {
        id: GoodsReceiptId.unsafe(id),
        branchId: TEST_BRANCH_ID,
        supplier: { id: SUPPLIER, code: 'SUP-A', nameEn: 'Gulf Fresh' },
        documentRef: 'DN-1',
        supplierInvoiceRef: null,
        invoiceDate: null,
        varianceNote: null,
        purchaseOrderId: null,
        receivedAt: '2026-07-27T09:00:00Z',
        receivedOn: '2026-07-27',
        costStatus: 'complete',
        unpricedLineCount: 0,
        valuationPendingCount: 0,
        currencyCode: 'USD',
        receiptTotalAmount: '25.000000',
        discountAmount: null,
        taxAmount: null,
        deliveryAmount: null,
        otherChargesAmount: null,
        invoiceTotalAmount: null,
        costsRedacted: false,
        lines: [
            {
                id: `${id}-line`,
                stockItemId: StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b1'),
                purchaseOrderLineId: null,
                quantity: '10.0000',
                unitId: null,
                unitPriceAmount: '2.500000',
                lineTotalAmount: '25.000000',
                costCurrencyCode: 'USD',
                costedAt: '2026-07-27T09:00:00Z',
                valuationPendingFx: false,
            },
        ],
        ...overrides,
    };
}

const REFERENCE: ProcurementReference = {
    currencies: [],
    defaultCurrencyCode: 'USD',
    measurementUnits: [],
};

describe('procurement receipts headers', () => {
    it('gives every column a header control, and the Prices header narrows the receipts', async () => {
        await renderStubScreen(<ProcurementScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listGoodsReceipts: async () => [
                        receipt(RECEIPT_PRICED),
                        receipt(RECEIPT_UNPRICED, {
                            costStatus: 'unpriced',
                            documentRef: 'DN-2',
                            receiptTotalAmount: null,
                        }),
                    ],
                    listSuppliers: async () => [],
                    listStockItems: async () => [],
                    getProcurementReference: async () => REFERENCE,
                },
            },
        });

        await untilVisible('kitchen-procurement-receipts-table');

        for (const column of ['receivedAt', 'supplier', 'lines', 'refs', 'total', 'costStatus']) {
            expect(screen.getByTestId(`kitchen-procurement-column-${column}-trigger`)).toBeTruthy();
        }

        // Total sorts on the press. The arrow is decorative, so it is only in the hidden tree.
        await press('kitchen-procurement-column-total-trigger');
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-procurement-column-total-sorted', {
                    includeHiddenElements: true,
                }),
            ).toBeTruthy();
        });

        // Prices is a value list over the closed set of three.
        await press('kitchen-procurement-column-costStatus-trigger');
        await untilVisible('kitchen-procurement-column-costStatus-unpriced');
        expect(screen.getByTestId('kitchen-procurement-column-costStatus-partial')).toBeTruthy();
        await press('kitchen-procurement-column-costStatus-unpriced');

        await waitFor(() => {
            expect(
                screen.queryByTestId(`${goodsReceiptRowTestId(RECEIPT_PRICED)}-supplier`),
            ).toBeNull();
        });
        expect(
            screen.getByTestId(`${goodsReceiptRowTestId(RECEIPT_UNPRICED)}-supplier`),
        ).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Production orders
 * ---------------------------------------------------------------------------------------------- */

const OTHER_BRANCH = BranchId.unsafe('01935f6d-0000-7000-8000-0000000000f9');
const ORDER_HERE = '01935f6d-0000-7000-8000-0000000000e1';
const ORDER_THERE = '01935f6d-0000-7000-8000-0000000000e2';

function productionOrder(id: string, overrides: Partial<ProductionOrder> = {}): ProductionOrder {
    return {
        id: ProductionOrderId.unsafe(id),
        recipeVersionId: RecipeVersionId.unsafe('01935f6d-0000-7000-8000-0000000000c1'),
        status: 'planned',
        branchId: TEST_BRANCH_ID,
        ...overrides,
    };
}

describe('production orders headers', () => {
    it('gives every column a header control, and the Branch header narrows the orders', async () => {
        await renderStubScreen(<ProductionScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listProductionOrders: async () => [
                        productionOrder(ORDER_HERE),
                        productionOrder(ORDER_THERE, {
                            branchId: OTHER_BRANCH,
                            status: 'completed',
                        }),
                    ],
                },
            },
        });

        await untilVisible('kitchen-production-orders');

        for (const column of ['id', 'version', 'branch', 'status']) {
            expect(screen.getByTestId(`kitchen-production-column-${column}-trigger`)).toBeTruthy();
        }

        // Status offers all four, Cancelled included, though the segments name three.
        await press('kitchen-production-column-status-trigger');
        await untilVisible('kitchen-production-column-status-cancelled');
        await press('kitchen-production-column-status-trigger');

        // Branch offers the branches the orders carry.
        await press('kitchen-production-column-branch-trigger');
        await untilVisible(`kitchen-production-column-branch-${String(OTHER_BRANCH)}`);
        await press(`kitchen-production-column-branch-${String(OTHER_BRANCH)}`);

        await waitFor(() => {
            expect(
                screen.queryByTestId(`${productionOrderRowTestId(ORDER_HERE)}-status`),
            ).toBeNull();
        });
        expect(screen.getByTestId(`${productionOrderRowTestId(ORDER_THERE)}-status`)).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Quality checks
 * ---------------------------------------------------------------------------------------------- */

const CHECK_RECEIPT = '01935f6d-0000-7000-8000-0000000000a7';
const CHECK_BATCH = '01935f6d-0000-7000-8000-0000000000a8';

function qualityCheck(id: string, overrides: Partial<QualityCheck> = {}): QualityCheck {
    return {
        id: QualityCheckId.unsafe(id),
        subjectType: 'goods_receipt',
        subjectId: RECEIPT_PRICED,
        status: 'pending',
        ...overrides,
    };
}

describe('quality checks headers', () => {
    it('gives every column a header control, and the Kind header narrows the checks', async () => {
        await renderStubScreen(<QualityControlScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listQualityChecks: async () => [
                        qualityCheck(CHECK_RECEIPT),
                        qualityCheck(CHECK_BATCH, {
                            subjectType: 'production_order',
                            subjectId: ORDER_HERE,
                        }),
                    ],
                },
            },
        });

        await untilVisible('kitchen-qc-checks');

        for (const column of ['subject', 'kind', 'status']) {
            expect(screen.getByTestId(`kitchen-qc-column-${column}-trigger`)).toBeTruthy();
        }

        await press('kitchen-qc-column-kind-trigger');
        await untilVisible('kitchen-qc-column-kind-production_order');
        await press('kitchen-qc-column-kind-production_order');

        await waitFor(() => {
            expect(screen.queryByTestId(`${qualityCheckRowTestId(CHECK_RECEIPT)}-kind`)).toBeNull();
        });
        expect(screen.getByTestId(`${qualityCheckRowTestId(CHECK_BATCH)}-kind`)).toBeTruthy();
    });
});
