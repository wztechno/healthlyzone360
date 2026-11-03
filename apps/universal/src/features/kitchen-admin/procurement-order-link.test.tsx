import type {
    GoodsReceipt,
    PostGoodsReceiptRequest,
    ReceivableOrder,
} from '@healthy360/api-client/contracts';
import { GoodsReceiptId, PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import {
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { goodsReceiptRowTestId } from './ops-format.ts';
import { ProcurementScreen } from './screens/procurement-screen.tsx';
import { ReceiveDeliveryScreen } from './screens/receive-delivery-screen.tsx';

/**
 * The way from a supply order to its delivery, for whoever is unloading the van.
 *
 * 1. **Procurement says what is expected.** Open orders sit above the receipts, one press from being
 *    received, for `inventory.manage` holders whether or not they can open the order book.
 * 2. **A receipt names its order**, as a link only for someone the order page would let in.
 * 3. **Posting a delivery lands somewhere the reader may be.**
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1440, height: 900, scale: 1, fontScale: 1 }),
}));

const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
    prefetch: jest.fn(),
};

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => mockRouter,
    usePathname: () => '/kitchen/procurement',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

const ORDER = PurchaseOrderId.unsafe('01935f6d-0000-7000-8000-0000000000c1');
const SUPPLIER = SupplierId.unsafe('01935f6d-0000-7000-8000-0000000000a1');
const FLOUR = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b1');
const RECEIPT = '01935f6d-0000-7000-8000-0000000000d1';

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

beforeEach(() => {
    for (const fn of Object.values(mockRouter)) fn.mockClear();
});

function openOrder(index = 1): ReceivableOrder {
    return {
        id:
            index === 1
                ? ORDER
                : PurchaseOrderId.unsafe(`01935f6d-0000-7000-8000-00000000c${String(100 + index)}`),
        number: `SO-2026-00${String(index + 10)}`,
        status: 'issued',
        branchId: TEST_BRANCH_ID,
        supplier: { id: SUPPLIER, code: 'MILL', nameEn: 'The Mill' },
        issuedAt: '2026-10-20T08:00:00Z',
        lineCount: 1,
        outstandingLineCount: 1,
        lines: [
            {
                purchaseOrderLineId: 'po-line-flour',
                stockItemId: FLOUR,
                itemCode: 'ING-0001',
                itemNameEn: 'Flour',
                itemNameAr: null,
                unitCode: 'kg',
                unitId: 'unit-kg',
                orderedQuantity: '50',
                receivedQuantity: '0',
                outstandingQuantity: '50',
            },
        ],
    };
}

function receipt(): GoodsReceipt {
    return {
        id: GoodsReceiptId.unsafe(RECEIPT),
        branchId: TEST_BRANCH_ID,
        supplier: { id: SUPPLIER, code: 'MILL', nameEn: 'The Mill' },
        documentRef: 'DN-1',
        supplierInvoiceRef: null,
        invoiceDate: null,
        varianceNote: null,
        purchaseOrderId: ORDER,
        purchaseOrderNumber: 'SO-2026-0011',
        receivedAt: '2026-10-21T09:00:00Z',
        receivedOn: '2026-10-21',
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
        lines: [],
    };
}

/** A manager at the test kitchen, less the codes named: the session a chef or a clerk holds. */
function sessionWithout(...codes: readonly string[]) {
    const context = testActiveContext();
    return kitchenManagerSession({
        activeContext: {
            ...context,
            permissions: context.permissions.filter((code) => !codes.includes(code)),
        },
    });
}

const WITHOUT_ORDERING = sessionWithout('inventory.order_supplies_organisation');

function book(listReceivableOrders: () => Promise<readonly ReceivableOrder[]>) {
    return {
        kitchenOps: {
            listGoodsReceipts: async () => [receipt()],
            listStockItems: async () => [],
            listReceivableOrders,
        },
    };
}

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

const ROW = 'kitchen-procurement-receipts-table';
const ORDER_REF = `${goodsReceiptRowTestId(RECEIPT)}-order`;

describe('awaiting delivery', () => {
    it('takes a receiver who cannot open the order book straight to the delivery', async () => {
        await renderStubScreen(<ProcurementScreen />, {
            session: WITHOUT_ORDERING,
            repositories: book(async () => [openOrder()]),
        });

        await untilVisible(`kitchen-procurement-awaiting-${String(ORDER)}`);
        const row = within(screen.getByTestId(`kitchen-procurement-awaiting-${String(ORDER)}`));
        expect(row.getByText('SO-2026-0011')).toBeTruthy();
        expect(row.getByText('1 line to come')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-procurement-awaiting-all')).toBeNull();

        await press(`kitchen-procurement-awaiting-${String(ORDER)}-receive`);

        expect(mockRouter.push).toHaveBeenCalledWith(
            `/kitchen/procurement/receive?order=${String(ORDER)}`,
        );
    });

    it('shows the oldest five and hands the rest to the delivery page', async () => {
        const orders = [1, 2, 3, 4, 5, 6].map(openOrder);
        await renderStubScreen(<ProcurementScreen />, {
            session: kitchenManagerSession(),
            repositories: book(async () => orders),
        });

        await untilVisible('kitchen-procurement-awaiting-all');
        expect(screen.getByText('All 6 open orders')).toBeTruthy();
        expect(
            screen.queryByTestId(`kitchen-procurement-awaiting-${String(orders[5]?.id)}`),
        ).toBeNull();

        await press('kitchen-procurement-awaiting-all');

        expect(mockRouter.push).toHaveBeenCalledWith('/kitchen/procurement/receive');
    });

    it.each([
        ['nothing is out', kitchenManagerSession(), async () => []],
        [
            'the orders cannot be read',
            kitchenManagerSession(),
            async () => {
                throw new Error('refused');
            },
        ],
        [
            'the reader cannot receive',
            sessionWithout('inventory.manage_organisation'),
            async () => [openOrder()],
        ],
    ])('leaves the book alone when %s', async (_case, session, listReceivableOrders) => {
        await renderStubScreen(<ProcurementScreen />, {
            session,
            repositories: book(listReceivableOrders),
        });

        await untilVisible(ROW);
        expect(screen.queryByTestId('kitchen-procurement-awaiting')).toBeNull();
    });
});

describe('a receipt names its order', () => {
    it('links the number for someone who can open the order', async () => {
        await renderStubScreen(<ProcurementScreen />, {
            session: kitchenManagerSession(),
            repositories: book(async () => []),
        });

        await untilVisible(ORDER_REF);
        expect(screen.getByTestId(ORDER_REF).props.accessibilityRole).toBe('link');

        await press(ORDER_REF);

        expect(mockRouter.push).toHaveBeenCalledWith(`/kitchen/supply-orders/${String(ORDER)}`);
    });

    it('reads as plain text for someone who cannot', async () => {
        await renderStubScreen(<ProcurementScreen />, {
            session: WITHOUT_ORDERING,
            repositories: book(async () => []),
        });

        await untilVisible(ORDER_REF);
        expect(screen.getByTestId(ORDER_REF).props.accessibilityRole).toBeUndefined();
    });
});

describe('after posting a delivery', () => {
    async function postDelivery(session: ReturnType<typeof kitchenManagerSession>) {
        const posted: PostGoodsReceiptRequest[] = [];
        await renderStubScreen(<ReceiveDeliveryScreen order={String(ORDER)} />, {
            session,
            repositories: {
                kitchenOps: {
                    listReceivableOrders: async () => [openOrder()],
                    listStockItems: async () => [],
                    postGoodsReceipt: async (request: PostGoodsReceiptRequest) => {
                        posted.push(request);
                        return {
                            id: GoodsReceiptId.unsafe(RECEIPT),
                            receivedOn: null,
                            costStatus: 'complete' as const,
                        };
                    },
                },
            },
        });

        await untilVisible('kitchen-receive-line-0-quantity-input');
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-receive-line-0-quantity-input').props.value).toBe(
                '50',
            );
        });
        await press('kitchen-receive-screen-save');
        await untilVisible('kitchen-receive-confirm-post');
        await press('kitchen-receive-confirm-post');
        await waitFor(() => {
            expect(posted).toHaveLength(1);
        });
    }

    it('replaces the form with the order for someone who can read it', async () => {
        await postDelivery(kitchenManagerSession());

        await waitFor(() => {
            expect(mockRouter.replace).toHaveBeenCalledWith(
                `/kitchen/supply-orders/${String(ORDER)}`,
            );
        });
        expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it('returns everyone else to the book, not to a page that refuses them', async () => {
        await postDelivery(WITHOUT_ORDERING);

        await waitFor(() => {
            expect(mockRouter.replace).toHaveBeenCalledWith('/kitchen/procurement');
        });
    });
});
