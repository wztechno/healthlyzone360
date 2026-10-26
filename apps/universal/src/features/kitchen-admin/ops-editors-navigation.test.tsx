import { ApiError, validationFailure } from '@healthy360/api-client';
import type {
    OrderProposal,
    ProcurementReference,
    PurchaseOrder,
    StockItem,
} from '@healthy360/api-client/contracts';
import { BranchId, PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { focusField } from './field-focus.ts';
import { stockItemLineFieldId } from './ops-line-editor.tsx';
import { purchaseOrderLineTestId } from './ops-format.ts';
import { CustomerDetailScreen } from './screens/customer-detail-screen.tsx';
import { PostReceiptScreen } from './screens/post-receipt-screen.tsx';
import { ProductionBatchNewScreen } from './screens/production-batch-new-screen.tsx';
import { ReceiveDeliveryScreen } from './screens/receive-delivery-screen.tsx';
import { SupplyOrderBuilderScreen } from './screens/supply-order-builder-screen.tsx';
import { SupplyOrderDetailScreen } from './screens/supply-order-detail-screen.tsx';
import { SupplyOrderPrintScreen } from './screens/supply-order-print-screen.tsx';
import { UnpricedReceiptScreen } from './screens/unpriced-receipt-screen.tsx';

/**
 * The operations editors and detail pages, as somebody who does not know the system moves through
 * them.
 *
 * 1. **Back is a step, not a jump.** Back, Cancel and a not-found page's way out return to the page
 *    before — the list as it was left — the way the browser's own arrow does. Only a page opened
 *    with nothing behind it (a link, a refresh) opens the list afresh, and a page opened as a detour
 *    (`?returnTo=`) goes back to where the detour began.
 * 2. **A save never does nothing.** Pressed with something wrong, it takes the reader to the first
 *    field that is wrong — its own check or the server's refusal — rather than sitting disabled.
 * 3. **Notices are one band of one-line strips**, without the paragraph under each title.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }),
}));

/** Whether there is a page behind this one, as the router reports it. */
const mockHistory = { canGoBack: true };
const mockParams: { current: Record<string, string> } = { current: {} };
const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismissTo: jest.fn(),
    canGoBack: jest.fn(() => mockHistory.canGoBack),
    setParams: jest.fn(),
    prefetch: jest.fn(),
};

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => mockRouter,
    usePathname: () => '/kitchen',
    useLocalSearchParams: () => mockParams.current,
    Redirect: () => null,
    Link: ({ children }: { children: ReactNode }) => children,
}));

// Where a press takes the reader is the assertion; the focus itself is the browser's to do.
jest.mock('./field-focus.ts', () => ({ focusField: jest.fn(), focusSection: jest.fn() }));

beforeEach(() => {
    mockHistory.canGoBack = true;
    mockParams.current = {};
    for (const fn of Object.values(mockRouter)) fn.mockClear();
    jest.mocked(focusField).mockClear();
});

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

async function type(testID: string, text: string) {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(testID), text);
    });
}

/** Went one step back, and opened nothing fresh on the way. */
function expectSteppedBack() {
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const BRANCH = BranchId.unsafe(String(TEST_BRANCH_ID));
const ITEM = StockItemId.unsafe('01935f6d-0000-7000-8000-00000000e001');
const ORDER = PurchaseOrderId.unsafe('01935f6d-0000-7000-8000-00000000d001');
const SUPPLIER = SupplierId.unsafe('01935f6d-0000-7000-8000-00000000f001');

const SHELF: StockItem = {
    id: ITEM,
    code: 'ITM-01',
    nameEn: 'Item 1',
    unitCode: 'kg',
    ingredientId: null,
    catalogueItemId: null,
    backing: 'ingredient',
    isStocked: true,
    hasHistory: true,
};

function purchaseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
    return {
        id: ORDER,
        number: 'PO-ABCDEF01',
        status: 'draft',
        branch: { id: BRANCH, name: 'Main kitchen' },
        supplier: {
            id: SUPPLIER,
            code: 'SUP-01',
            nameEn: 'Supplier 1',
            nameAr: null,
            archivedAt: null,
        },
        recipientSnapshot: null,
        notes: null,
        lineCount: 1,
        issuedAt: null,
        receivedAt: null,
        closedAt: null,
        closeShortReason: null,
        cancelledAt: null,
        createdAt: '2026-08-17T09:00:00+00:00',
        lines: [
            {
                id: '01935f6d-0000-7000-8000-00000000c001',
                stockItemId: ITEM,
                itemCode: 'ITM-01',
                itemNameEn: 'Item 1',
                itemNameAr: null,
                quantity: '4.0000',
                receivedQuantity: '0.0000',
                outstandingQuantity: '4.0000',
                unitCode: 'kg',
                supplierItemRef: null,
                notes: null,
                displayOrder: 0,
            },
        ],
        receipts: [],
        ...overrides,
    };
}

function detailWorld(
    order: PurchaseOrder,
    extra: RepositoryOverrides['kitchenOps'] = {},
): RepositoryOverrides {
    return {
        kitchenOps: {
            getPurchaseOrder: async () => order,
            listStockItems: async () => [SHELF],
            ...extra,
        },
    };
}

const REFERENCE: ProcurementReference = {
    currencies: [],
    defaultCurrencyCode: 'USD',
    measurementUnits: [{ id: 'unit-kg', code: 'kg', dimension: 'mass', nameEn: 'Kilogram' }],
};

function receiptWorld(extra: RepositoryOverrides['kitchenOps'] = {}): RepositoryOverrides {
    return {
        kitchenOps: {
            listSuppliers: async () => [],
            listStockItems: async () => [SHELF],
            getProcurementReference: async () => REFERENCE,
            listReceivableOrders: async () => [],
            listItemLatestPurchases: async () => [],
            ...extra,
        },
    };
}

const EMPTY_PROPOSAL: OrderProposal = {
    items: [],
    branchId: BRANCH,
    outOfStockCount: 0,
    lowStockCount: 0,
    unassignedCount: 0,
    requestedItemCount: 0,
};

const POST_LINES = 'kitchen-procurement-post-lines';
const LINE_QUANTITY = `${purchaseOrderLineTestId(String(ITEM))}-quantity`;

/* ------------------------------------------------------------------------------------------------
 * 1. Back is a step
 * ---------------------------------------------------------------------------------------------- */

describe('going back from an operations page', () => {
    it('steps back from a supply order to the book as it was left, not to a fresh one', async () => {
        await renderStubScreen(<SupplyOrderDetailScreen order={String(ORDER)} />, {
            session: kitchenManagerSession(),
            repositories: detailWorld(purchaseOrder()),
        });
        await untilVisible('kitchen-supply-order-detail-screen-back');

        await press('kitchen-supply-order-detail-screen-back');

        expectSteppedBack();
    });

    it('opens the book afresh only when nothing is behind the page', async () => {
        mockHistory.canGoBack = false;
        await renderStubScreen(<SupplyOrderDetailScreen order="not-an-identifier" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: {} },
        });
        await untilVisible('kitchen-supply-order-detail-not-found-back');

        await press('kitchen-supply-order-detail-not-found-back');

        expect(mockRouter.back).not.toHaveBeenCalled();
        expect(mockRouter.replace).toHaveBeenCalledWith('/kitchen/supply-orders');
        expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('steps back from the print sheet to the order it was printed from', async () => {
        await renderStubScreen(<SupplyOrderPrintScreen orders={undefined} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: {} },
        });
        await untilVisible('kitchen-supply-print-back');

        await press('kitchen-supply-print-back');

        expectSteppedBack();
    });

    it('steps back from the builder on Cancel', async () => {
        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getOrderProposal: async () => EMPTY_PROPOSAL,
                    listSuppliers: async () => [],
                    listStockItems: async () => [SHELF],
                },
            },
        });
        await untilVisible('kitchen-supply-order-builder-cancel');

        await press('kitchen-supply-order-builder-cancel');

        expectSteppedBack();
    });

    it('steps back from a goods receipt on Cancel', async () => {
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: receiptWorld(),
        });
        await untilVisible(`${POST_LINES}-row-line-first-item`);

        await press('kitchen-procurement-post-cancel');

        expectSteppedBack();
    });

    it('steps back from receiving a delivery', async () => {
        await renderStubScreen(<ReceiveDeliveryScreen order={undefined} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listReceivableOrders: async () => [],
                    listStockItems: async () => [SHELF],
                },
            },
        });
        await untilVisible('kitchen-receive-screen-back');

        await press('kitchen-receive-screen-back');

        expectSteppedBack();
    });

    it('steps back from a receipt that is not there', async () => {
        await renderStubScreen(<UnpricedReceiptScreen receipt="not-an-identifier" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { listStockItems: async () => [SHELF] } },
        });
        await untilVisible('kitchen-unpriced-receipt-not-found-back');
        await press('kitchen-unpriced-receipt-not-found-back');
        expectSteppedBack();
    });

    it('steps back from a customer who is not there', async () => {
        await renderStubScreen(<CustomerDetailScreen customer="" />, {
            session: kitchenManagerSession(),
            repositories: {},
        });
        await untilVisible('kitchen-customer-not-found-back');
        await press('kitchen-customer-not-found-back');
        expectSteppedBack();
    });

    it('steps back from a new batch on Cancel', async () => {
        await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listRecipes: async () => page([]) } },
        });
        await untilVisible('kitchen-production-batch-new-back');
        await press('kitchen-production-batch-new-back');
        expectSteppedBack();
    });

    it('goes back to where a detour began when the page was opened as one', async () => {
        mockParams.current = { returnTo: '/kitchen/production-desk?status=draft' };
        await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: { listRecipes: async () => page([]) } },
        });
        await untilVisible('kitchen-production-batch-new-back');
        await press('kitchen-production-batch-new-back');

        expect(mockRouter.dismissTo).toHaveBeenCalledWith('/kitchen/production-desk?status=draft');
        expect(mockRouter.back).not.toHaveBeenCalled();
        expect(mockRouter.push).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------------------------------------
 * 2. A save never does nothing
 * ---------------------------------------------------------------------------------------------- */

describe('pressing save with something wrong', () => {
    it('takes a supply order Save to the quantity that does not read, and sends nothing', async () => {
        const updatePurchaseOrder = jest.fn(async () => purchaseOrder());
        await renderStubScreen(<SupplyOrderDetailScreen order={String(ORDER)} />, {
            session: kitchenManagerSession(),
            repositories: detailWorld(purchaseOrder(), { updatePurchaseOrder }),
        });
        await untilVisible(`${LINE_QUANTITY}-input`);

        await type(`${LINE_QUANTITY}-input`, 'a few');
        // Said under the box as it is typed, and Save stays a button that goes somewhere.
        await untilVisible(`${LINE_QUANTITY}-error`);
        expect(screen.getByTestId('kitchen-supply-order-detail-screen-save')).not.toBeDisabled();

        await press('kitchen-supply-order-detail-screen-save');

        expect(focusField).toHaveBeenCalledWith(LINE_QUANTITY);
        expect(updatePurchaseOrder).not.toHaveBeenCalled();
    });

    it('takes a refused supply order save to the field the server named', async () => {
        await renderStubScreen(<SupplyOrderDetailScreen order={String(ORDER)} />, {
            session: kitchenManagerSession(),
            repositories: detailWorld(purchaseOrder(), {
                updatePurchaseOrder: async () => {
                    throw new ApiError(
                        validationFailure({ 'lines.0.quantity': ['Too much for one order.'] }),
                    );
                },
            }),
        });
        await untilVisible(`${LINE_QUANTITY}-input`);

        await type(`${LINE_QUANTITY}-input`, '9000');
        await press('kitchen-supply-order-detail-screen-save');

        await waitFor(() => {
            expect(focusField).toHaveBeenCalledWith(LINE_QUANTITY);
        });
        await untilVisible(`${LINE_QUANTITY}-error`);
        expect(screen.getByTestId(`${LINE_QUANTITY}-error`)).toHaveTextContent(
            'Too much for one order.',
        );
    });

    it('takes Post on a goods receipt to the first line field missing', async () => {
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: receiptWorld(),
        });
        await untilVisible(`${POST_LINES}-row-line-first-item`);

        await press('kitchen-procurement-post-confirm');

        expect(focusField).toHaveBeenCalledWith(
            stockItemLineFieldId(POST_LINES, 'line-first', 'item'),
        );
    });

    it('takes a refused goods receipt to the first field the server named, in form order', async () => {
        await renderStubScreen(<PostReceiptScreen />, {
            session: kitchenManagerSession(),
            repositories: receiptWorld({
                postGoodsReceipt: async () => {
                    throw new ApiError(
                        validationFailure({
                            'lines.0.quantity': ['The quantity must be at least 0.0001.'],
                            supplier_invoice_ref: ['The invoice number is too long.'],
                        }),
                    );
                },
            }),
        });
        await untilVisible(`${POST_LINES}-row-line-first-item`);

        await press(`${POST_LINES}-row-line-first-item-trigger`);
        await act(async () => {
            fireEvent.press(
                await screen.findByTestId(`${POST_LINES}-row-line-first-item-option-${ITEM}`),
            );
        });
        await type(`${POST_LINES}-row-line-first-quantity-input`, '24');
        await type('kitchen-procurement-post-invoice-ref-input', 'INV-0001');
        await press('kitchen-procurement-post-confirm');

        // The invoice number sits above the lines, so it is where the reader is taken.
        await waitFor(() => {
            expect(focusField).toHaveBeenCalledWith('kitchen-procurement-post-invoice-ref');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * 3. Notices are one band of one-line strips
 * ---------------------------------------------------------------------------------------------- */

describe("an order's notices", () => {
    it('draws them in one band, each a title without a paragraph under it', async () => {
        await renderStubScreen(<SupplyOrderDetailScreen order={String(ORDER)} />, {
            session: kitchenManagerSession(),
            repositories: detailWorld(
                purchaseOrder({
                    status: 'cancelled',
                    cancelledAt: '2026-08-18T10:00:00+00:00',
                    supplier: {
                        id: SUPPLIER,
                        code: 'SUP-01',
                        nameEn: 'Supplier 1',
                        nameAr: null,
                        archivedAt: '2026-08-18T09:00:00+00:00',
                    },
                }),
            ),
        });
        await untilVisible('kitchen-supply-order-detail-notices');

        const band = screen.getByTestId('kitchen-supply-order-detail-notices');
        expect(band).toContainElement(
            screen.getByTestId('kitchen-supply-order-detail-cancelled-notice'),
        );
        expect(band).toContainElement(
            screen.getByTestId('kitchen-supply-order-detail-archived-notice'),
        );
        expect(
            screen.queryByTestId('kitchen-supply-order-detail-cancelled-notice-body'),
        ).toBeNull();
        expect(screen.queryByTestId('kitchen-supply-order-detail-archived-notice-body')).toBeNull();
    });

    it('draws no band at all when there is nothing to say', async () => {
        await renderStubScreen(<SupplyOrderDetailScreen order={String(ORDER)} />, {
            session: kitchenManagerSession(),
            repositories: detailWorld(purchaseOrder()),
        });
        await untilVisible('kitchen-supply-order-detail-lines-table');

        expect(screen.queryByTestId('kitchen-supply-order-detail-notices')).toBeNull();
    });
});
